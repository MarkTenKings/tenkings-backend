using OpenCvSharp;
using TenKings.AiGrader.Worker.Core;

namespace TenKings.AiGrader.Pylon.Host;

internal sealed class PylonPreviewFrameEncoder : IPreviewFrameEncoder
{
    public int JpegQuality => 85;
    public ValueTask<PreviewJpeg> EncodeJpegAsync(CameraFrame frame, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        frame.Validate();
        using var source = Mat.FromPixelData(frame.Height, frame.Width, MatType.CV_8UC1, frame.Mono8, frame.Stride);
        return ValueTask.FromResult(EncodeBounded(source, cancellationToken));
    }

    private static PreviewJpeg EncodeBounded(Mat source, CancellationToken cancellationToken)
    {
        var quality = 85;
        Mat current = source;
        var ownsCurrent = false;
        try
        {
            for (var attempt = 0; attempt < 16; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                Cv2.ImEncode(".jpg", current, out var bytes, new ImageEncodingParam(ImwriteFlags.JpegQuality, quality));
                if (bytes.Length is > 0 and <= PreviewJpeg.MaximumBytes)
                {
                    return new PreviewJpeg(bytes, current.Width, current.Height);
                }

                if (quality > 20)
                {
                    quality = Math.Max(20, quality - 15);
                    continue;
                }

                var ratio = bytes.Length > 0
                    ? Math.Clamp(Math.Sqrt(PreviewJpeg.MaximumBytes / (double)bytes.Length) * 0.85, 0.35, 0.85)
                    : 0.5;
                var nextWidth = Math.Max(64, (int)Math.Floor(current.Width * ratio));
                var nextHeight = Math.Max(64, (int)Math.Floor(current.Height * ratio));
                if (nextWidth == current.Width && nextHeight == current.Height)
                {
                    break;
                }

                var resized = new Mat();
                Cv2.Resize(current, resized, new Size(nextWidth, nextHeight), 0, 0, InterpolationFlags.Area);
                if (ownsCurrent)
                {
                    current.Dispose();
                }
                current = resized;
                ownsCurrent = true;
            }

            throw new InvalidOperationException("jpeg_encode_exceeded_protocol_bound");
        }
        finally
        {
            if (ownsCurrent)
            {
                current.Dispose();
            }
        }
    }
}
