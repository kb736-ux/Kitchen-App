/**
 * Sheek palette — keep in sync with tokens.css and MyReactNativeApp/constants/theme.js
 * Loaded as a classic script; use SheekColors.* from dashboard JS.
 */
class SheekColors {
  static bg = '#F7F4EE';
  static surface = '#FFFEFB';
  static primary = '#332A25';
  static primaryHover = '#4A3D36';
  static secondary = '#81766D';
  static border = '#DED8D1';
  static text = '#242220';
  static textMuted = '#746E69';
  static success = '#52705A';
  static successSoft = '#E4EBE6';
  static warning = '#B57A35';
  static warningSoft = '#F4E8D4';
  static error = '#A94F47';
  static errorSoft = '#F4E4E2';
  static onPrimary = '#FFFEFB';
  static primarySoft = '#E3E0DA';

  static toast(type) {
    return type === 'error' ? SheekColors.error : SheekColors.success;
  }
}

window.SheekColors = SheekColors;
