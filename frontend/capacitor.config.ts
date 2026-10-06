import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.basera.app',
  appName: 'Basera',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { adjustMarginsForEdgeToEdge: 'force', backgroundColor: '#F5F6F4' },
  ios: { contentInset: 'automatic', backgroundColor: '#F5F6F4' },
  plugins: {
    // The splash stays up until React has rendered (app/native.js hides it).
    SplashScreen: { launchAutoHide: false, launchFadeOutDuration: 200, backgroundColor: '#F5F6F4', showSpinner: false, androidScaleType: 'CENTER_CROP' }
  }
};

export default config;
