import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation

enum GeneratorError: Error {
    case usage
    case writerCreationFailed(String)
    case inputRejected
    case pixelBufferPoolUnavailable
    case pixelBufferCreationFailed
    case appendFailed(Int)
    case finishFailed(String)
}

let args = CommandLine.arguments
guard args.count == 2 else {
    throw GeneratorError.usage
}

let outputURL = URL(fileURLWithPath: args[1])
let outputDir = outputURL.deletingLastPathComponent()
try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
if FileManager.default.fileExists(atPath: outputURL.path) {
    try FileManager.default.removeItem(at: outputURL)
}

let width = 64
let height = 64
let fps: Int32 = 12
let frameCount = 12

guard let writer = try? AVAssetWriter(outputURL: outputURL, fileType: .mov) else {
    throw GeneratorError.writerCreationFailed("cannot create AVAssetWriter")
}

let outputSettings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.hevcWithAlpha,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
]

let input = AVAssetWriterInput(mediaType: .video, outputSettings: outputSettings)
input.expectsMediaDataInRealTime = false

let adaptorAttributes: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    kCVPixelBufferIOSurfacePropertiesKey as String: [:],
]

let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: adaptorAttributes
)

guard writer.canAdd(input) else {
    throw GeneratorError.inputRejected
}
writer.add(input)

guard writer.startWriting() else {
    throw GeneratorError.writerCreationFailed(writer.error?.localizedDescription ?? "startWriting failed")
}
writer.startSession(atSourceTime: .zero)

func drawFrame(into pixelBuffer: CVPixelBuffer, index: Int) {
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

    guard
        let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer),
        let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
        )
    else {
        return
    }

    let bounds = CGRect(x: 0, y: 0, width: width, height: height)
    context.clear(bounds)

    let progress = CGFloat(index) / CGFloat(max(frameCount - 1, 1))
    let centerX = 18 + progress * 28
    let centerY = 34 - sin(progress * .pi) * 10

    context.setFillColor(CGColor(red: 1.0, green: 0.76, blue: 0.22, alpha: 0.92))
    context.fillEllipse(in: CGRect(x: centerX - 14, y: centerY - 14, width: 28, height: 28))

    context.setFillColor(CGColor(red: 0.22, green: 0.55, blue: 1.0, alpha: 0.52))
    context.fill(CGRect(x: centerX - 6, y: 10, width: 12, height: 44))

    context.setStrokeColor(CGColor(red: 0.95, green: 0.35, blue: 0.62, alpha: 0.85))
    context.setLineWidth(4)
    context.strokeEllipse(in: CGRect(x: centerX - 14, y: centerY - 14, width: 28, height: 28))
}

for index in 0..<frameCount {
    while !input.isReadyForMoreMediaData {
        Thread.sleep(forTimeInterval: 0.002)
    }
    guard let pool = adaptor.pixelBufferPool else {
        throw GeneratorError.pixelBufferPoolUnavailable
    }
    var maybePixelBuffer: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybePixelBuffer)
    guard status == kCVReturnSuccess, let pixelBuffer = maybePixelBuffer else {
        throw GeneratorError.pixelBufferCreationFailed
    }
    drawFrame(into: pixelBuffer, index: index)
    let time = CMTime(value: Int64(index), timescale: fps)
    if !adaptor.append(pixelBuffer, withPresentationTime: time) {
        throw GeneratorError.appendFailed(index)
    }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting {
    semaphore.signal()
}
semaphore.wait()

guard writer.status == .completed else {
    throw GeneratorError.finishFailed(writer.error?.localizedDescription ?? "finishWriting failed")
}

print(outputURL.path)
