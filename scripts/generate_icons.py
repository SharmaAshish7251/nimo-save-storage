import os
from PIL import Image, ImageDraw

SRC_PATH = r"C:\Users\Linux\.gemini\antigravity\brain\d0376f88-8579-4674-80cb-3ddd5f766743\.user_uploaded\media_1794050899925_5f41b8f0.jpg"
ROOT = r"D:\Dev AI\App\nimo-save-storage"

img = Image.open(SRC_PATH).convert("RGBA")

# 1. Main 1024x1024 App Icon
icon_1024 = img.resize((1024, 1024), Image.Resampling.LANCZOS)
icon_1024.save(os.path.join(ROOT, "assets/images/icon.png"), "PNG")
icon_1024.save(os.path.join(ROOT, "assets/images/app-logo.png"), "PNG")
icon_1024.save(os.path.join(ROOT, "assets/images/NOMI-Save-Storage.png"), "PNG")
icon_1024.save(os.path.join(ROOT, "assets/images/splash-icon.png"), "PNG")

# 2. Favicon (192x192)
fav = img.resize((192, 192), Image.Resampling.LANCZOS)
fav.save(os.path.join(ROOT, "assets/images/favicon.png"), "PNG")

# 3. Android Adaptive Icon:
# Background: Solid Black
bg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 255))
bg.save(os.path.join(ROOT, "assets/images/android-icon-background.png"), "PNG")

# Foreground: scaled to 72% so the character (crown, horns, buttons, feet) fits safely inside Android's circular/squircle mask
fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
scaled_char = img.resize((736, 736), Image.Resampling.LANCZOS)
fg.paste(scaled_char, (144, 144))
fg.save(os.path.join(ROOT, "assets/images/android-icon-foreground.png"), "PNG")

# 4. Android Native Splash Screen drawables
splash_densities = {
    "drawable-mdpi": 288,
    "drawable-hdpi": 432,
    "drawable-xhdpi": 576,
    "drawable-xxhdpi": 864,
    "drawable-xxxhdpi": 1152,
}
for folder, size in splash_densities.items():
    dest_dir = os.path.join(ROOT, "android/app/src/main/res", folder)
    os.makedirs(dest_dir, exist_ok=True)
    splash_resized = img.resize((size, size), Image.Resampling.LANCZOS)
    splash_resized.save(os.path.join(dest_dir, "splashscreen_logo.png"), "PNG")

# 5. Android Native Mipmap Launcher Icons (ic_launcher.webp and ic_launcher_round.webp)
mipmap_densities = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

for folder, size in mipmap_densities.items():
    dest_dir = os.path.join(ROOT, "android/app/src/main/res", folder)
    os.makedirs(dest_dir, exist_ok=True)
    
    icon_resized = img.resize((size, size), Image.Resampling.LANCZOS)
    icon_resized.save(os.path.join(dest_dir, "ic_launcher.webp"), "WEBP")
    
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size, size), fill=255)
    round_icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    round_icon.paste(icon_resized, (0, 0), mask=mask)
    round_icon.save(os.path.join(dest_dir, "ic_launcher_round.webp"), "WEBP")

print("All assets successfully generated!")

