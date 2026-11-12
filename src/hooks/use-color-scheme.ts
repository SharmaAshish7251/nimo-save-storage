import { useAppTheme } from '@/context/ThemeContext';
import { ColorSchemeName } from 'react-native';

export function useColorScheme(): NonNullable<ColorSchemeName> {
  const { resolvedTheme } = useAppTheme();
  return resolvedTheme;
}
