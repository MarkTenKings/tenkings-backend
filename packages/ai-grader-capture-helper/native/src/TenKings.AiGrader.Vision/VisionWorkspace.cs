using OpenCvSharp;

namespace TenKings.AiGrader.Vision;

internal sealed class VisionWorkspace : IDisposable
{
    public Mat Source { get; } = new();
    public Mat Corrected { get; } = new();
    public Mat Gray { get; } = new();
    public Mat Denoised { get; } = new();
    public Mat Contrast { get; } = new();
    public Mat Bright { get; } = new();
    public Mat Dark { get; } = new();
    public Mat Canny { get; } = new();
    public Mat BrightClosed { get; } = new();
    public Mat DarkClosed { get; } = new();
    public Mat EdgesClosed { get; } = new();
    public Mat GradientX { get; } = new();
    public Mat GradientY { get; } = new();
    public Mat MorphKernel { get; private set; } = new();
    private int _kernelSize;

    public void EnsureKernel(int size)
    {
        if (_kernelSize == size && !MorphKernel.Empty()) return;
        MorphKernel.Dispose();
        MorphKernel = Cv2.GetStructuringElement(MorphShapes.Rect, new Size(size, size));
        _kernelSize = size;
    }

    public void Dispose()
    {
        Source.Dispose();
        Corrected.Dispose();
        Gray.Dispose();
        Denoised.Dispose();
        Contrast.Dispose();
        Bright.Dispose();
        Dark.Dispose();
        Canny.Dispose();
        BrightClosed.Dispose();
        DarkClosed.Dispose();
        EdgesClosed.Dispose();
        GradientX.Dispose();
        GradientY.Dispose();
        MorphKernel.Dispose();
    }
}
