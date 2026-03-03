using System;
using System.Drawing;
using System.Net;

class Program {
    static void Main() {
        using (WebClient client = new WebClient()) {
            byte[] data = client.DownloadData("https://mario.wiki.gallery/images/2/22/MK64_Block_Fort_minimap.png");
            using (var ms = new System.IO.MemoryStream(data)) {
                Bitmap bmp = new Bitmap(ms);
                int width = 40;
                int height = 40;
                Bitmap resized = new Bitmap(bmp, new Size(width, height));
                for (int y = 0; y < height; y++) {
                    for (int x = 0; x < width; x++) {
                        Color c = resized.GetPixel(x, y);
                        if (c.A < 128) Console.Write(" ");
                        else if (c.R > 200 && c.G < 100 && c.B < 100) Console.Write("R");
                        else if (c.G > 200 && c.R < 100 && c.B < 100) Console.Write("G");
                        else if (c.B > 200 && c.R < 100 && c.G < 100) Console.Write("B");
                        else if (c.R > 200 && c.G > 200 && c.B < 100) Console.Write("Y");
                        else if (c.R < 50 && c.G < 50 && c.B < 50) Console.Write("#");
                        else Console.Write(".");
                    }
                    Console.WriteLine();
                }
            }
        }
    }
}
