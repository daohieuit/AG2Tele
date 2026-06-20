# AntiBridge Brand Guidelines

## 🎨 Logo Usage Rules

### Logo Files

| File | Description | Format |
|------|-------------|--------|
| `Logo_AntiBridge.png` | Main logo with white/cream background | PNG, ~4.7MB |
| `Logo_AntiBridge_Alpha.png` | Logo with transparent background | PNG, ~3.3MB |
| `Logo_AntiBridge.psd` | Source file (Photoshop) | PSD |
| `Icon_AntiBridge.ico` | Windows icon | ICO |

---

## ✅ Usage Guidelines

### Logo with White Background (`Logo_AntiBridge.png`)
**Use for:**
- README banner/hero image
- GitHub repository header
- Website header/hero section
- Marketing materials
- Documentation covers
- Large display areas
- ⭐ **APP LAUNCHER ICONS** (Android, iOS, Windows desktop) - ALWAYS use white background!

**Size recommendations:**
- README banner: width 200-300px
- Website hero: width 400-600px
- App launcher icon: 512x512, 192x192, 128x128

> ⚠️ **IMPORTANT**: All app icons that appear on home screen, desktop, or app drawer MUST use the white background version for brand consistency and visibility.

---

### Logo with Transparent Background (`Logo_AntiBridge_Alpha.png`)
**Use for:**
- Small icons (favicon, app icon)
- Status bar icons
- Navigation bar logos
- Floating buttons
- Dark theme backgrounds
- **Always add glow/shadow effect when on dark backgrounds**

**Size recommendations:**
- Favicon: 32x32, 64x64
- App icon: 128x128, 192x192, 512x512
- Small UI: 24-48px

**Glow effect (CSS example):**
```css
.logo-icon {
    filter: drop-shadow(0 0 10px rgba(59, 130, 246, 0.5));
}
```

---

## 🚫 Don't Do

- ❌ Don't use Alpha logo as main banner (too small/invisible on white backgrounds)
- ❌ Don't use White logo on dark backgrounds without adjustments
- ❌ Don't stretch or distort the logo
- ❌ Don't change the logo colors
- ❌ Don't add text directly on the logo

---

## 📁 File Locations

### Main Assets
```
D:\01_BUILD_APP\REMOTE_AGENT\Assets\
├── Logo_AntiBridge.png        ← Main banner logo
├── Logo_AntiBridge_Alpha.png  ← Icon/small logo
├── Logo_AntiBridge.psd        ← Source file
└── BRAND_GUIDELINES.md        ← This file
```

### Extension (AntiBridge_AutoAccept_Extension)
```
images/
├── logo-banner.png  ← Copy of Logo_AntiBridge.png (for README)
└── icon.png         ← Copy of Logo_AntiBridge_Alpha.png (for extension icon)
```

### Release (Antigravity-AntiBridge)
```
assets/
├── Logo_AntiBridge.png        ← For README banner
└── Logo_AntiBridge_Alpha.png  ← For small icons
```

---

## 🎯 Quick Reference

| Context | Use This Logo |
|---------|---------------|
| README.md banner | `Logo_AntiBridge.png` (white background) |
| VS Code extension icon | `Logo_AntiBridge_Alpha.png` (transparent) |
| **Android app launcher icon** | `Logo_AntiBridge.png` (white background) ⭐ |
| **iOS app icon** | `Logo_AntiBridge.png` (white background) ⭐ |
| **Windows desktop icon** | `Logo_AntiBridge.png` (white background) ⭐ |
| Website header | `Logo_AntiBridge.png` (white background) |
| Dark theme icon (inside app) | `Logo_AntiBridge_Alpha.png` + glow effect |
| Favicon | `Logo_AntiBridge_Alpha.png` (transparent) |
| Status bar / Navigation | `Logo_AntiBridge_Alpha.png` (transparent) + glow |

---

## 📝 Author

**Linh Bui**  
📧 Email: linhbq82@gmail.com  
🐙 GitHub: [linhbq82](https://github.com/linhbq82)  
📘 Facebook: [linhbuiart.io.vn](https://www.facebook.com/linhbuiart.io.vn/)  
☕ Buy Me a Coffee: [linhbq82](https://buymeacoffee.com/linhbq82)

Created: 2026-01-14  
Updated: 2026-01-22

---

## 🖼️ Additional Assets (v3.0.0)

### Chat Background (`background.png`)
**Usage:**
- Chat messages container background
- Both web frontend and mobile app
- Create immersive chat experience

**Size:** ~3.9MB
**Format:** PNG

**CSS implementation:**
```css
.messages-container {
    background-image: url('assets/background.png');
    background-size: cover;
    background-position: center;
}
```

---

### QR Code (`tang_banh_bao.jpg`)
**Usage:**
- Settings page (web and mobile)
- Donation/tip section
- Display with text: "tặng chiếc bánh bao"

**Size:** ~58KB
**Format:** JPG
**Recommended display size:** 100-120px

**Location in app:**
- Web: Settings modal, after version info
- Mobile: Settings screen, before debug log

