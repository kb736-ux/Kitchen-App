#!/bin/bash

# React Native Simulator Launcher Script

echo "🚀 React Native Simulator Launcher"
echo "=================================="

# Check if development server is running
if ! curl -s http://localhost:8081 > /dev/null; then
    echo "❌ Development server not running!"
    echo "Please run 'yarn start' first in another terminal"
    exit 1
fi

echo "✅ Development server is running"
echo ""
echo "Choose simulator:"
echo "1) iOS Simulator"
echo "2) Android Emulator" 
echo "3) Web Browser"
echo ""
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        echo "🍎 Launching iOS Simulator..."
        open -a Simulator
        sleep 3
        xcrun simctl boot "iPhone 15" 2>/dev/null || echo "Using default simulator"
        npx expo start --ios
        ;;
    2)
        echo "🤖 Launching Android Emulator..."
        if command -v adb &> /dev/null; then
            npx expo start --android
        else
            echo "❌ Android SDK not found. Please install Android Studio first."
            echo "Visit: https://developer.android.com/studio"
        fi
        ;;
    3)
        echo "🌐 Opening in web browser..."
        npx expo start --web
        ;;
    *)
        echo "❌ Invalid choice"
        ;;
esac