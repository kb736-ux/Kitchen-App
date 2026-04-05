# 🚀 React Native Development Guide

## Quick Start Testing

### 1. **Web Browser (Instant Testing)**
```bash
# Press 'w' in your terminal OR visit:
http://localhost:8081
```

### 2. **Phone Testing (Real Device)**
- Download "Expo Go" app
- Scan QR code from terminal/browser
- App loads instantly on your phone!

### 3. **Simulator Testing**
```bash
# iOS (Mac only)
Press 'i' in terminal

# Android  
Press 'a' in terminal
```

## 🔧 Development Workflow

### **Hot Reload Testing**
1. Open app in browser/phone
2. Edit any file (try changing text in App.js)
3. Save file (Cmd+S / Ctrl+S)
4. See changes instantly! ⚡

### **Debugging**
- **Console logs**: Check browser dev tools or terminal
- **React DevTools**: Install browser extension
- **Flipper**: Advanced debugging tool

### **File Structure**
```
MyReactNativeApp/
├── App.js                 # Main app (edit this!)
├── components/            # Reusable UI components
│   └── WelcomeCard.js    # Example component
├── utils/                # Helper functions
│   └── debugHelpers.js   # Debug utilities
└── assets/               # Images, icons, etc.
```

## 🎯 What to Try Next

### **Easy Changes (Start Here)**
1. **Change colors** in `styles` objects
2. **Modify text** in components
3. **Add new buttons** with different actions
4. **Change the app title** and emojis

### **Intermediate Features**
1. **Add new screens** (navigation)
2. **Connect to APIs** (fetch data)
3. **Add images** from assets folder
4. **Create forms** with TextInput

### **Advanced Features**
1. **State management** (Redux/Context)
2. **Database integration** (AsyncStorage)
3. **Push notifications**
4. **Camera/GPS features**

## 🐛 Common Issues & Solutions

### **Metro bundler issues**
```bash
# Clear cache and restart
yarn start --clear
```

### **Changes save on your Mac but the phone still shows the old UI**
This is almost always **stale JavaScript on the device** or **Expo Go talking to the wrong dev server**.

1. **Confirm the bundle version on the phone**  
   In development, a small line at the **bottom of the screen** shows `Build <stamp>`. That string comes from `constants/buildInfo.js` (`JS_BUNDLE_BUILD`).  
   - If the stamp **does not change** after you edit `buildInfo.js` and reload, the phone is **not** loading your latest project.

2. **Full reset (do this first)**  
   Stop Metro (Ctrl+C), then from **this** folder (`MyReactNativeApp`):
   ```bash
   npx expo start --tunnel --clear
   ```
   In **Expo Go**: shake device → **Reload** (or kill Expo Go and scan the QR again).

3. **Same project folder**  
   Make sure the terminal running Expo is `.../AppKitchen-copy-2/MyReactNativeApp` — not another copy of the repo elsewhere.

4. **Tunnel vs LAN**  
   `--tunnel` can lag or stick to an old session. If Mac and phone are on the **same Wi‑Fi**, try **without** tunnel:
   ```bash
   npx expo start --clear
   ```
   Use the **LAN** URL/QR from the terminal.

5. **Watchman (Mac)**  
   If files never trigger a rebundle:
   ```bash
   watchman watch-del-all
   ```

### **Package conflicts**
```bash
# Clean install
rm -rf node_modules yarn.lock
yarn install
```

### **iOS simulator not opening**
- Install Xcode from App Store
- Open Xcode → Preferences → Components → Install simulator

### **Android emulator not working**
- Install Android Studio
- Set up AVD (Android Virtual Device)

## 📱 Testing Checklist

- [ ] Web browser works
- [ ] Hot reload works (edit & save)
- [ ] Buttons are interactive
- [ ] Counter increments
- [ ] Alerts show up
- [ ] Scrolling works
- [ ] Phone testing (Expo Go)
- [ ] Console logs appear

## 🎨 Styling Tips

### **Colors**
```javascript
backgroundColor: '#3498db'  // Blue
color: '#e74c3c'           // Red
borderColor: '#2ecc71'     // Green
```

### **Layout**
```javascript
flex: 1,                   // Take full space
alignItems: 'center',      // Center horizontally
justifyContent: 'center',  // Center vertically
padding: 20,               // Space inside
margin: 10,                // Space outside
```

### **Text**
```javascript
fontSize: 18,
fontWeight: 'bold',
textAlign: 'center',
```

## 🚀 Ready to Code!

Your app is running and ready for development. Start by:
1. Opening the app in your browser
2. Making small changes to App.js
3. Watching the magic of hot reload! ✨