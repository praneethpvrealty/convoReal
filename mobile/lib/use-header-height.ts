// expo-router SDK 57 still ships react-navigation's elements bundle
// but without a public subpath, and marks the re-exports deprecated.
// Wrap the deep import here so the day SDK 58 removes it there is
// exactly one place to fix.
// eslint-disable-next-line import/no-internal-modules
export { useHeaderHeight } from 'expo-router/build/react-navigation/elements/Header/useHeaderHeight';
