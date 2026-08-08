"""
Generate Play Store compliant icon set from source icon.png.
- Preserves original design/colors for icon.png, android-icon-foreground.png, splash-icon.png
- Generates proper monochrome white-on-transparent for android-icon-monochrome.png
- Ensures all files are 1024x1024 RGBA PNG
"""
from PIL import Image
import os

ASSETS_DIR = r"C:\Users\kenik\OneDrive\Pictures\pagepay\client\assets\images"
SOURCE = os.path.join(ASSETS_DIR, "icon.png")

TARGETS = {
    "icon.png": "keep",
    "android-icon-foreground.png": "keep",
    "android-icon-monochrome.png": "mono",
    "splash-icon.png": "keep",
}


def generate_monochrome(source_path: str, output_path: str):
    src = Image.open(source_path).convert("RGBA")
    if src.size != (1024, 1024):
        src = src.resize((1024, 1024), Image.LANCZOS)

    # Build monochrome image: white where original is opaque, transparent elsewhere
    mono = Image.new("RGBA", src.size, (0, 0, 0, 0))
    src_pixels = list(src.getdata())
    mono_pixels = []
    for r, g, b, a in src_pixels:
        if a > 10:
            mono_pixels.append((255, 255, 255, 255))
        else:
            mono_pixels.append((0, 0, 0, 0))
    mono.putdata(mono_pixels)
    mono.save(output_path, "PNG")
    print(f"Generated monochrome: {output_path}")


def validate_and_copy(source_path: str, output_path: str):
    src = Image.open(source_path).convert("RGBA")
    if src.size != (1024, 1024):
        src = src.resize((1024, 1024), Image.LANCZOS)
    src.save(output_path, "PNG")
    print(f"Validated: {output_path}")


def main():
    if not os.path.exists(SOURCE):
        raise FileNotFoundError(f"Source icon not found: {SOURCE}")

    print(f"Source: {SOURCE}")
    src_img = Image.open(SOURCE)
    print(f"Source size: {src_img.size}, mode: {src_img.mode}")

    for filename, action in TARGETS.items():
        output = os.path.join(ASSETS_DIR, filename)
        if action == "mono":
            generate_monochrome(SOURCE, output)
        else:
            validate_and_copy(SOURCE, output)

    print("\nDone. Icon set generated at:")
    for f in TARGETS:
        print(f"  {os.path.join(ASSETS_DIR, f)}")


if __name__ == "__main__":
    main()
