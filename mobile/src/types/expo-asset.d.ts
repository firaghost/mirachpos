declare module 'expo-asset' {
  export const Asset: {
    fromModule(moduleId: number): { uri: string; localUri?: string | null; downloadAsync: () => Promise<void> }
  }
}
