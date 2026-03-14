# MyReactNativeApp

A React Native app built with Expo.

## Getting Started

### Prerequisites
- Node.js (v20.10.0 or higher)
- Yarn package manager
- Expo CLI

### Installation

1. Install dependencies:
```bash
yarn install
```

### Running the App

- **Start the development server:**
```bash
yarn start
```

- **Run on Android:**
```bash
yarn android
```

- **Run on iOS:**
```bash
yarn ios
```

- **Run on Web:**
```bash
yarn web
```

### Development

- The main app component is in `App.js`
- Assets are stored in the `assets/` directory
- App configuration is in `app.json`

### Expo Development

This project uses Expo for easy development and deployment. You can:
- Use the Expo Go app on your phone to test the app
- Use the web interface at `http://localhost:19006`
- Use Android/iOS simulators

### Project Structure

```
MyReactNativeApp/
├── App.js              # Main app component
├── app.json           # Expo configuration
├── assets/            # Images and other assets
├── index.js           # Entry point
├── package.json       # Dependencies and scripts
└── README.md          # This file
```