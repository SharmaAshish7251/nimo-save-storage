import React from 'react';
import { View, StyleSheet, Image } from 'react-native';

export function AnimatedSplashOverlay() {
  return null;
}

export function AnimatedIcon() {
  return (
    <View style={styles.iconContainer}>
      <Image
        style={styles.image}
        source={require('@/assets/images/app-logo.png')}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 128,
    height: 128,
  },
  image: {
    width: 100,
    height: 100,
  },
});
