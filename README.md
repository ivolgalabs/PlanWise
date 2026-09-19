<div align="center">

# 📅 PlanWise

**Minimalist, lightning-fast offline task planner for macOS, Android, and Desktop.**  
*Built with Tauri v2, Rust, React 19, and SQLite.*

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8D8?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Android%20%7C%20Web-green.svg)](https://ivolgalabs.com)

[Website](https://ivolgalabs.com) • [Storefront](https://website.ivolgalabs.workers.dev) • [Features](#key-features) • [Quick Start](#quick-start) • [Architecture](#architecture)

</div>

---

## 🌟 Overview

**PlanWise** is an open-source, local-first calendar task planner inspired by Tweek and Bullet Journal methodology. Designed for thinkers, creators, and developers who value mental clarity, friction-free planning, and absolute privacy.

Unlike web-based SaaS tools that trap your schedule in proprietary clouds, PlanWise stores 100% of your data locally in an encrypted or plain SQLite database. It boots in under **600 milliseconds**, consumes negligible battery, and operates seamlessly without an internet connection.

---

## ⚡ Key Features

- **🔒 100% Offline & Local-First**: Zero external servers, zero mandatory accounts, zero telemetry. Your data stays on your machine in a robust SQLite database (WAL mode).
- **🖥️ Native macOS WidgetKit Widgets**: Live interactive desktop widgets for Today, Week, and Someday tasks written in native Swift and SwiftUI.
- **📱 Native Android Widgets & Exact Alarms**: Home screen widgets and non-delayed notifications scheduled via Android `AlarmManager` with low battery drain.
- **🌅 Morning Digest & Travel Alert**: Intelligent notifications: wake up to an inbox-style summary of today's schedule, and receive "time-to-leave" warnings before scheduled meetings.
- **📂 Horizon Planning ("Someday")**: Organize open-ended intentions into collapsible horizons: *Someday*, *Within a week*, and *Within a month* with soft deadlines.
- **⚠️ Conflict Detection**: Instant $O(n)$ detection and visual highlighting of overlapping time slots across scheduled tasks.
- **🎯 Hierarchical Subtasks & Drag-and-Drop**: Natural ordering with `@dnd-kit` — breakdown complex objectives into actionable checklist steps.
- **🔄 Local Safe Auto-Sync**: Automatic atomic file backups (`daily-planner-sync.json`) to any local directory, Syncthing folder, or NAS mount.
- **🎨 Universal Design System**: Smooth dark, light, and OLED themes with adaptive typography, safe-area insets, and customizable accents.

---

## 🏗️ Architecture & Tech Stack

```
PlanWise/
├── src/                    # Frontend (React 19 + TypeScript + Zustand)
│   ├── App.tsx             # Root coordinator & store sync
│   ├── store.ts            # Reactive UI preferences (Zustand + Persist)
│   ├── api.ts              # Tauri invoke bridge + browser fallback backend
│   ├── views/              # Day, Week, and Month planning views
│   ├── components/         # TaskCard, MiniCalendar, Subtasks, Modals
│   └── autoSync.ts         # Debounced file-based local sync engine
├── src-tauri/              # Core Engine (Rust + Tauri v2)
│   ├── src/db.rs           # SQLite engine (rusqlite + refinery migrations)
│   ├── src/commands.rs     # IPC command handlers & widget data writer
│   ├── src/notify.rs       # Adaptive scheduler & notification dispatcher
│   └── widgets/            # macOS WidgetKit extension (Swift / SwiftUI)
└── vendor/universal-ui/    # Offline design tokens & responsive CSS
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: `v20+` or `v22+` (with `npm`)
- **Rust**: `1.80+` with Cargo
- **Tauri v2 CLI**: `cargo install tauri-cli --version "^2.0.0"` (optional if using `npx tauri`)

### Installation & Development

```bash
# Clone the repository
git clone https://github.com/ivolgalabs/PlanWise.git
cd PlanWise

# Install frontend dependencies
npm install

# Run in Web Browser mode (uses browser localStorage mock backend)
npm run dev

# Run in full Desktop mode (Tauri + Rust backend)
npx tauri dev
```

### Production Builds

```bash
# Typecheck & build web bundle
npm run build

# Package macOS Desktop Application (with WidgetKit extension)
npm run build:macos

# Build Android APK (Release)
cd src-tauri && npx tauri android build --apk
```

---

## 🧪 Testing

```bash
# Run TypeScript static type check
npm run test

# Run Rust unit tests for notifications and database
cd src-tauri && cargo test
```

---

## 📄 License

This project is licensed under the **Apache License 2.0** — see the [LICENSE](LICENSE) file for details.

Developed with precision by **[Ivolga Labs](https://ivolgalabs.com)**. For questions or support, reach out via [support@ivolgalabs.com](mailto:support@ivolgalabs.com) or open a [GitHub Issue](https://github.com/ivolgalabs/PlanWise/issues).
