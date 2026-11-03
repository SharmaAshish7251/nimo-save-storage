import { View, StyleSheet, Text, TextInput, TouchableOpacity, ScrollView, Image, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { saveApiCredentials, getApiCredentials } from '@/lib/storage/secure';
import { startAuth, signIn, signInWithPassword, initializeClient } from '@/lib/telegram/client';

export default function TelegramLoginScreen() {
  const [step, setStep] = useState<'phone' | 'code' | '2fa'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [loading, setLoading] = useState(false);

  // Optional custom credentials
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      pulseAnim.setValue(1);
      rotateAnim.setValue(0);
    }
  }, [loading]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const sendCode = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      return;
    }

    if (!trimmedPhone.startsWith('+')) {
      return;
    }

    setLoading(true);
    try {
      console.log('[AUTH] Sending code to', trimmedPhone);
      // Clear any cached login
      (globalThis as any).__nimo_cached_login = null;
      const result = await startAuth(trimmedPhone);
      console.log('[AUTH] Code sent successfully');
      setPhoneCodeHash(result.phoneCodeHash);
      setStep('code');
    } catch (error: any) {
      console.log('[AUTH] Error:', error?.errorMessage || error?.message);
      console.error(error);
      if (String(error?.errorMessage || error?.message).includes('AUTH_RESTART')) {
        // Try once more with fresh client
        setTimeout(() => sendCode(), 500);
        return;
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      return;
    }

    setLoading(true);
    try {
      console.log('[AUTH] Verifying code...');
      await signIn(phone.trim(), trimmedCode, phoneCodeHash);
      console.log('[AUTH] Sign in successful');
      setLoading(false);
      router.replace('/');
    } catch (error: any) {
      console.log('[AUTH] Verify error:', error?.errorMessage || error?.message);
      console.error(error);
      if (error.errorMessage === 'SESSION_PASSWORD_NEEDED' || error.message === '2FA_PASSWORD_REQUIRED' || String(error.message).includes('SESSION_PASSWORD_NEEDED')) {
        console.log('[AUTH] Switching to 2FA step');
        setLoading(false);
        setStep('2fa');
        return;
      } else {
      }
    }
    setLoading(false);
  };

  const verify2FA = async () => {
    if (!password) {
      return;
    }

    setLoading(true);
    try {
      await Promise.race([
        (async () => {
          const c = await initializeClient();
          if (!c) throw new Error('Failed to initialize client');
          try {
            if (!(c as any).isConnected?.()) {
              await c.connect();
            }
          } catch {}
          const passwordSrp: any = await (c as any).invoke(new (await import('telegram')).Api.account.GetPassword());
          const { computeCheck } = await import('telegram/Password');
          const passwordSrpCheck = await computeCheck(passwordSrp, password);
          await (c as any).invoke(new (await import('telegram')).Api.auth.CheckPassword({ password: passwordSrpCheck }));
          const sessionStr = (c as any).session.save();
          const { saveSession } = await import('@/lib/storage/secure');
          await saveSession(sessionStr);
          const cached = { value: true, timestamp: Date.now() };
          (globalThis as any).__nimo_cached_login = cached;
          return true;
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout. Please try again.')), 45000))
      ]);
      setLoading(false);
      router.replace('/');
    } catch (error: any) {
    } finally {
      setLoading(false);
    }
  };

  const saveCustomCredentials = async () => {
    if (!apiId.trim() || !apiHash.trim()) {
      return;
    }
    try {
      await saveApiCredentials(apiId.trim(), apiHash.trim());
    } catch (e: any) {
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <Image
            source={require('@/assets/images/app-logo.png')}
            style={styles.logo}
          />
          <Text style={styles.title}>Telegram Login</Text>

          {/* STEP 1: DIRECT PHONE NUMBER LOGIN */}
          {step === 'phone' && (
            <View style={styles.form}>
              <Text style={styles.instruction}>
                Enter your mobile number to sign in with Telegram.
              </Text>
              
              <Text style={styles.label}>Mobile Phone Number</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 234 567 8900"
                placeholderTextColor="#999"
                keyboardType="phone-pad"
                autoFocus
              />
              <Text style={styles.helpText}>
                Include country code (e.g., +1 for US/Canada, +91 for India, +44 for UK).
              </Text>

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={sendCode}
                disabled={loading}
              >
                <Animated.View style={{ transform: [{ scale: pulseAnim }, { rotate: loading ? spin : '0deg' }] }}>
                  <Text style={styles.buttonText}>
                    {loading ? 'Sending Code...' : 'Send Login Code'}
                  </Text>
                </Animated.View>
              </TouchableOpacity>

              {/* Advanced / Custom Credentials Collapsible */}
              <TouchableOpacity
                style={styles.advancedToggle}
                onPress={() => setShowAdvanced(!showAdvanced)}
              >
                <Text style={styles.advancedToggleText}>
                  {showAdvanced ? '▼ Hide Custom API Credentials' : '⚙️ Custom API Credentials (Optional)'}
                </Text>
              </TouchableOpacity>

              {showAdvanced && (
                <View style={styles.advancedCard}>
                  <Text style={styles.advancedNote}>
                    Default official credentials are used automatically. You only need to change this if you have your own app from my.telegram.org.
                  </Text>
                  <Text style={styles.label}>API ID</Text>
                  <TextInput
                    style={styles.input}
                    value={apiId}
                    onChangeText={setApiId}
                    placeholder="e.g. 2040"
                    placeholderTextColor="#999"
                    keyboardType="numeric"
                  />
                  <Text style={styles.label}>API Hash</Text>
                  <TextInput
                    style={styles.input}
                    value={apiHash}
                    onChangeText={setApiHash}
                    placeholder="32 character hash"
                    placeholderTextColor="#999"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={saveCustomCredentials}
                  >
                    <Text style={styles.secondaryButtonText}>Save Custom Credentials</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* STEP 2: VERIFICATION CODE */}
          {step === 'code' && (
            <View style={styles.form}>
              <Text style={styles.instruction}>
                We sent a login code to your Telegram app on another device or via SMS.
              </Text>

              <Text style={styles.label}>Verification Code</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="1 2 3 4 5"
                placeholderTextColor="#999"
                keyboardType="numeric"
                autoFocus
              />

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={verifyCode}
                disabled={loading}
              >
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <Text style={styles.buttonText}>
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
                  </Text>
                </Animated.View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={() => setStep('phone')}
                disabled={loading}
              >
                <Text style={styles.textButtonText}>Change Phone Number</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={() => {
                  if (loading) return;
                  setCode('');
                  setLoading(true);
                  (async () => {
                    try {
                      console.log('[AUTH] Resending code...');
                      (globalThis as any).__nimo_cached_login = null;
                      const { initializeClient } = await import('@/lib/telegram/client');
                      const c = await initializeClient();
                      if (c) {
                        try { await c.disconnect(); } catch {}
                      }
                      // reset client
                      const mod = await import('@/lib/telegram/client');
                      (mod as any).client = null;
                      const result = await mod.startAuth(phone.trim());
                      setPhoneCodeHash(result.phoneCodeHash);
                    } catch (error: any) {
                      console.log('[AUTH] Resend error:', error?.errorMessage || error?.message);
                    } finally {
                      setLoading(false);
                    }
                  })();
                }}
                disabled={loading}
              >
                <Text style={styles.textButtonText}>Resend Code</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* STEP 3: 2FA PASSWORD */}
          {step === '2fa' && (
            <View style={styles.form}>
              <Text style={styles.instruction}>
                Your account is protected with Two-Step Verification. Enter your password to continue.
              </Text>

              <Text style={styles.label}>2FA Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Your Telegram Password"
                placeholderTextColor="#999"
                secureTextEntry
                autoFocus
              />

              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={verify2FA}
                disabled={loading}
              >
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <Text style={styles.buttonText}>
                    {loading ? 'Signing In...' : 'Confirm Password'}
                  </Text>
                </Animated.View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={() => {
                  if (loading) return;
                  setStep('phone');
                  setLoading(false);
                  setPassword('');
                  setCode('');
                }}
                disabled={loading}
              >
                <Text style={styles.textButtonText}>Cancel & Start Over</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    color: '#111',
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 22,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  instruction: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
    color: '#111',
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 4,
    textAlign: 'center',
  },
  helpText: {
    fontSize: 13,
    color: '#777',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#208AEF',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  textButton: {
    marginTop: 16,
    padding: 10,
    alignItems: 'center',
  },
  textButtonText: {
    color: '#208AEF',
    fontSize: 15,
    fontWeight: '500',
  },
  advancedToggle: {
    marginTop: 32,
    paddingVertical: 12,
    alignItems: 'center',
  },
  advancedToggleText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  advancedCard: {
    backgroundColor: '#eaecee',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  advancedNote: {
    fontSize: 12,
    color: '#666',
    marginBottom: 14,
    lineHeight: 18,
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '600',
  },
});
