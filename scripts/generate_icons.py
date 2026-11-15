import os
from PIL import Image, ImageDraw

ROOT = r"D:\Dev AI\App\nimo-save-storage"
SRC_PATH = os.path.join(ROOT, "assets/images/new-logo.png")

img = Image.open(SRC_PATH).convert("RGBA")

def create_rounded_mask(size, radius, supersample=4):
    w, h = size
    sw, sh = w * supersample, h * supersample
    sr = radius * supersample
    mask = Image.new("L", (sw, sh), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, sw - 1, sh - 1), radius=sr, fill=255)
    return mask.resize((w, h), Image.Resampling.LANCZOS)

# 1. Main 1024x1024 App Icon (Square for store, rounded for app/splash)
icon_1024 = img.resize((1024, 1024), Image.Resampling.LANCZOS)
icon_1024.save(os.path.join(ROOT, "assets/images/icon.png"), "PNG")

# App logo & splash icon with ~12px corner radius (scaled to ~68px on 1024 canvas for 180dp display)
mask_1024 = create_rounded_mask((1024, 1024), 68)
app_logo_rounded = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
app_logo_rounded.paste(icon_1024, (0, 0), mask=mask_1024)
app_logo_rounded.save(os.path.join(ROOT, "assets/images/app-logo.png"), "PNG")
app_logo_rounded.save(os.path.join(ROOT, "assets/images/splash-icon.png"), "PNG")

# 2. Favicon (192x192)
fav_mask = create_rounded_mask((192, 192), 14)
fav_img = icon_1024.resize((192, 192), Image.Resampling.LANCZOS)
fav = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
fav.paste(fav_img, (0, 0), mask=fav_mask)
fav.save(os.path.join(ROOT, "assets/images/favicon.png"), "PNG")

# 3. Android Adaptive Icon:
bg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 255))
bg.save(os.path.join(ROOT, "assets/images/android-icon-background.png"), "PNG")

fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
scaled_char = img.resize((736, 736), Image.Resampling.LANCZOS)
fg.paste(scaled_char, (144, 144))
fg.save(os.path.join(ROOT, "assets/images/android-icon-foreground.png"), "PNG")

# 4. Android Native Splash Screen drawables
splash_configs = {
    "drawable-mdpi": (288, 180, 12),
    "drawable-hdpi": (432, 270, 18),
    "drawable-xhdpi": (576, 360, 24),
    "drawable-xxhdpi": (864, 540, 36),
    "drawable-xxxhdpi": (1152, 720, 48),
}

for folder, (canvas_size, logo_size, radius) in splash_configs.items():
    dest_dir = os.path.join(ROOT, "android/app/src/main/res", folder)
    if os.path.exists(dest_dir):
        logo_resized = img.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
        logo_mask = create_rounded_mask((logo_size, logo_size), radius)
        
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
        offset = (canvas_size - logo_size) // 2
        canvas.paste(logo_resized, (offset, offset), mask=logo_mask)
        canvas.save(os.path.join(dest_dir, "splashscreen_logo.png"), "PNG")

print("All assets successfully generated with ~12px rounded corner radius!")
