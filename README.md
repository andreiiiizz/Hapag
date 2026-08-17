<div align="center">

<h1 align="center" style="font-family: 'Playfair Display', Georgia, serif; font-size: 3.2rem; font-weight: 700; letter-spacing: 0.08em; color: #FFC880; margin-bottom: 0;">
  HAPAG
</h1>
<p style="font-size: 1.15rem; color: #D7C3AE; margin-top: 4px;">
  <strong>Filipino Ulam Kiosk & Recipe Finder</strong>
</p>

<p><strong>An intelligent, touch-friendly Filipino dish discovery kiosk & meal planner powered by Google Gemini AI.</strong></p>

[![Electron](https://img.shields.io/badge/Electron-31.0+-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini%202.5%20Flash-8E75B2?style=flat-square&logo=google&logoColor=white)](https://aistudio.google.com/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

[Features](#-key-features) • [Getting Started](#-getting-started) • [Packaging](#-building-installers) • [Project Structure](#-project-structure) • [Tech Stack](#-tech-stack)

</div>

---

## 📖 Overview

**Hapag** (*Hapag-Kainan*, meaning "dining table" in Filipino) is an interactive culinary kiosk and desktop recipe discovery app designed to answer the everyday Filipino question: *"Ano'ng ulam natin?"* (What's for dinner?).

Featuring an authentic catalog of classic Filipino dishes referencing culinary standards from [Panlasang Pinoy](https://panlasangpinoy.com), **Hapag** pairs offline speed with cloud AI intelligence. Search dishes by name, filter by traditional cooking method (*Sabaw, Gisa, Prito, Inihaw, Gulay*), match recipes based on ingredients available in your fridge, get instant chef tips and substitutions from **Google Gemini**, and follow step-by-step interactive cooking checklists.

---

## ✨ Key Features

### 🥘 1. Curated Filipino Ulam Catalog
- **Multi-Category Browsing**: Filter by traditional preparation styles (**Sabaw** / Soups, **Gisa** / Sauté & Stews, **Prito** / Fried, **Inihaw** / Grilled, **Gulay** / Vegetables) and main proteins (Chicken, Pork, Beef, Seafood).
- **Comprehensive Recipe Cards**: Pre-bundled with cooking times, difficulty ratings, portion sizes, ingredients, and step-by-step methods with zero initial loading lag.
- **Deep-linking & Attribution**: Direct links to authentic recipe sources on Panlasang Pinoy.

### 🤖 2. Gemini AI Chef Assistant
- **Live AI Advice**: Ask the AI Chef for **Smart Substitutions**, **Rice & Sawsawan (Dipping Sauce) Pairings**, and **Chef Secrets & Pro Tips** for any dish.
- **AI-Powered Pantry Search**: When you select rare or diverse ingredient combinations, Gemini generates custom, authentic Filipino recipes tailored to your exact pantry.
- **Dynamic Dish Discovery & Procedural Generation**: If you search for an ulam not in the local database, Hapag queries Gemini and live culinary sources to generate accurate recipes on the fly.

### 🥗 3. "My Kitchen" Smart Ingredient Matcher
- **Inventory-Based Cooking**: Select whatever ingredients you have in your kitchen (Pork, Chicken, Kangkong, Sayote, Eggplant, Coconut Milk, etc.).
- **Automatic Pantry Staple Detection**: Common staples (salt, pepper, cooking oil, water, garlic, onions, rice) are automatically treated as on-hand.
- **Dynamic Match Percentage**: Displays match ratios (`Best match`, `Quickest`, `A–Z`) so you know what you can cook right now and what missing ingredients you need to buy.

### 🖼️ 4. Dynamic Authentic Photo Engine
- **Automated Dish Imagery**: Queries Wikipedia and Wikimedia Commons in real-time to locate and cache high-resolution, authentic photos for every dish.
- **Two-Tier Caching**: Uses in-memory caching and persistent local disk caching (`renderer/images/cache`) for instant reload and offline resilience.

### 👨‍🍳 5. Interactive Step-by-Step Cooking Checklist
- **Cooking Progress Bar**: Check off ingredients and instructions in real-time as you cook.
- **One-Click Cooking Log**: Mark dishes as cooked to automatically record them to your activity history.

### ❤️ 6. Favorites & Cooking Activity Log
- Save your favorite family recipes with a single tap.
- Track past cooking sessions with timestamps and easy history management.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher
- **Google Gemini API Key**: Get a free key from [Google AI Studio](https://aistudio.google.com/apikey) (No credit card required).

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/andreiiiizz/Hapag.git
   cd ulam-finder-electron
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
   Open `.env` in your text editor and add your Gemini API key:
   ```env
   GOOGLE_API_KEY=your_actual_gemini_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```

4. **Run the desktop app**:
   ```bash
   npm start
   ```

---

## 📦 Building Installers

Hapag is configured with `electron-builder` to produce standalone cross-platform executables:

```bash
# Windows (.exe installer via NSIS)
npm run dist:win

# macOS (.dmg / .app — build on macOS)
npm run dist:mac

# Linux (AppImage)
npm run dist:linux

# Auto-detect current platform
npm run dist
```

> [!NOTE]
> Packaged application binaries and installers will be generated inside the `release/` directory.

---

## 📁 Project Structure

```text
ulam-finder-electron/
├── renderer/                # Frontend UI & Kiosk Application
│   ├── images/              # Dish assets and dynamic image cache
│   │   ├── cache/           # Locally cached web images
│   │   └── dishes/          # Bundled offline dish images
│   ├── app.js               # Main UI controller & reactive state manager
│   ├── data.js              # Filipino ulam database & ingredient taxonomy
│   ├── index.html           # Kiosk layout, templates & modals
│   └── style.css            # Dark warm theme & responsive kiosk styling
├── .env.example             # Template for API credentials
├── main.js                  # Electron main process & IPC handlers
├── preload.js               # Secure IPC contextBridge bridge
├── package.json             # App manifest, build configs & dependencies
└── README.md                # Project documentation
```

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| <kbd>/</kbd> | Focus global search bar |
| <kbd>Esc</kbd> | Dismiss active recipe, close picker, or exit cooking modal |

---

## 🛠️ Tech Stack

- **Desktop Framework**: [Electron](https://www.electronjs.org/) (v31+)
- **Packaging**: [electron-builder](https://www.electron.build/)
- **AI Model**: [Google Gemini 2.5 Flash](https://aistudio.google.com/) via Google Generative Language API
- **Frontend**: Vanilla ES Modules, Semantic HTML5, CSS3 Custom Properties
- **Typography**: Playfair Display, Hanken Grotesk, JetBrains Mono, Google Material Symbols
- **Image Sources**: Wikipedia & Wikimedia Commons API

---

## 🤝 Contributing

Contributions, recipe additions, and feature suggestions are welcome!
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingUlamFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingUlamFeature'`)
4. Push to the Branch (`git push origin feature/AmazingUlamFeature`)
5. Open a Pull Request

---

## 📜 Acknowledgements

- [Panlasang Pinoy](https://panlasangpinoy.com) — For authentic Filipino recipes and culinary inspiration.
- [Google AI Studio](https://aistudio.google.com) — For free, rapid generative AI capabilities with Gemini.
- [Wikimedia Commons](https://commons.wikimedia.org) — For open culinary imagery.

---

<div align="center">
  <sub>Built with ❤️ for Filipino food lovers everywhere. Kain tayo! 🍚</sub>
</div>
