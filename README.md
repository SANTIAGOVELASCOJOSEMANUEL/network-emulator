# Network Emulator

Modern web-based network simulator focused on visualization, education, and interactive protocol analysis.

## Features

- Interactive network topology builder
- Router and switch simulation
- Packet lifecycle visualization
- Routing visualization
- NAT visualization
- VLAN support
- OSPF simulation
- BGP simulation
- MPLS support
- VPN simulation
- CLI terminal inspired by Cisco IOS
- Real-time packet inspection
- Modular architecture
- Event-driven core
- Built with Vite

---

# Tech Stack

- JavaScript / TypeScript (WIP)
- Vite
- HTML5 Canvas
- CSS3
- Event-Driven Architecture

---

# Project Structure

```txt
src/
├── core/
├── protocols/
├── ui/
├── visualizers/
├── utils/
├── services/
└── store/
```

---

# Architecture Goals

- Remove global dependencies (`window.*`)
- Centralized state management
- Event-driven communication
- Decoupled rendering engine
- Scalable protocol system
- High-performance topology rendering

---

# Current Protocol Support

| Protocol | Status |
|----------|--------|
| ARP | ✅ |
| ICMP | ✅ |
| TCP | ✅ |
| UDP | ✅ |
| VLAN | ✅ |
| NAT | ✅ |
| OSPF | ✅ |
| BGP | ✅ |
| MPLS | ⚠️ Experimental |
| VPN | ⚠️ Experimental |

---

# Installation

```bash
git clone https://github.com/your-repo/network-emulator.git
cd network-emulator
npm install
npm run dev
```

---

# Development Roadmap

## Core Refactor
- [x] Migrate to Vite
- [x] Introduce Event Bus
- [ ] Remove remaining `window.*`
- [ ] Implement centralized store
- [ ] Separate simulation engine from renderer

## TypeScript Migration
- [ ] Core engine
- [ ] Packet system
- [ ] Protocol engines
- [ ] Visualizers

## Performance
- [ ] Render optimization
- [ ] Packet batching
- [ ] Large topology support
- [ ] Object pooling

## Future Features
- [ ] Multiplayer collaboration
- [ ] Cloud save
- [ ] Shareable labs
- [ ] AI assistant
- [ ] Exam mode
- [ ] Replay system

---

# Vision

This project aims to become a modern educational network simulation platform focused on:

- Visualization
- Interactivity
- Accessibility
- Real-time protocol analysis

Instead of only simulating networks, the goal is to help users understand how networks actually work.

---

# License

MIT License

---

# Disclaimer

This project is under active development.  
Some protocols and features are experimental and may change frequently.

Because apparently building a full network simulator in a browser sounded like a calm and reasonable life decision.