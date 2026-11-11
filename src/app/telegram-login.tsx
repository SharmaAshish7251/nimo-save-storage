import { View, StyleSheet, Text, TextInput, TouchableOpacity, ScrollView, Image, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { saveApiCredentials } from '@/lib/storage/secure';
import { tdLibClient } from '@/lib/tdlib/client';

export default function TelegramLoginScreen() {
  const [step, setStep] = useState<'phone' | 'code' | '2fa'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Optional custom credentials
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');

  const [pulseAnim] = useState(() => new Animated.Value(1));
  const [rotateAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    tdLibClient.isLoggedIn().then((loggedIn) => {
      if (loggedIn) {
        console.log('[AUTH] Already logged in, returning home');
        router.replace('/');
      }
    });
  }, []);

  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.timing(rotateAnim, { toValue: 1, duration: 1000, useNativeDriver: true })
      ).start();
    } else {
      pulseAnim.setValue(1);
      rotateAnim.setValue(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const sendCode = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone || !trimmedPhone.startsWith('+')) return;

    setLoading(true);
    setError('');
    try {
      // Fix 3.4: Auto-save custom credentials before initiating login (don't require explicit Save tap)
      if (apiId.trim() && apiHash.trim()) {
        await saveApiCredentials(apiId.trim(), apiHash.trim());
      }
      console.log('[AUTH] Initiating TDLib login for', trimmedPhone);
      await tdLibClient.loginWithPhone(trimmedPhone);
      console.log('[AUTH] TDLib code requested successfully');
      setStep('code');
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error('[AUTH] sendCode error:', msg);
      if (msg.includes('AUTH_RESTART')) {
        setTimeout(() => sendCode(), 500);
        return;
      }
      setError(msg || 'Failed to send code. Check phone number and try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    setLoading(true);
    setError('');
    try {
      console.log('[AUTH] Verifying code via TDLib...');
      await tdLibClient.verifyCode(trimmedCode);
      console.log('[AUTH] TDLib verify successful');
      router.replace('/');
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.log('[AUTH] verifyCode error:', msg);
      if (msg.includes('PASSWORD') || msg.includes('2FA') || msg.includes('SESSION_PASSWORD_NEEDED')) {
        console.log('[AUTH] Switching to 2FA step');
        setStep('2fa');
        return;
      }
      setError(msg || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verify2FA = async () => {
    if (!password) return;

    setLoading(true);
    setError('');
    try {
      console.log('[AUTH] TDLib 2FA verify...');
      await tdLibClient.verifyPassword(password);
      console.log('[AUTH] TDLib 2FA successful');
      router.replace('/');
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error('[AUTH] 2FA error:', msg);
      setError(msg || 'Wrong password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    if (loading) return;
    setCode('');
    setError('');
    setLoading(true);
    try {
      console.log('[AUTH] Resending code...');
      // TDLib handles resend by calling login again with the same phone
      await tdLibClient.loginWithPhone(phone.trim());
      console.log('[AUTH] Code resent successfully');
    } catch (err: any) {
      console.log('[AUTH] Resend error:', err?.message || err);
      setError('Failed to resend code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const saveCustomCredentials = async () => {
    if (!apiId.trim() || !apiHash.trim()) return;
    try {
      await saveApiCredentials(apiId.trim(), apiHash.trim());
    } catch {}
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

          {/* Error banner */}
          {!!error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* STEP 1: PHONE NUMBER */}
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

              {/* Advanced / Custom Credentials */}
              <TouchableOpacity
                style={styles.advancedToggle}
                onPress={() => setShowAdvanced(!showAdvanced)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <FontAwesome
                    name={showAdvanced ? 'chevron-up' : 'cog'}
                    size={13}
                    color="#208AEF"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.advancedToggleText}>
                    {showAdvanced ? 'Hide Custom API Credentials' : 'Custom API Credentials (Optional)'}
                  </Text>
                </View>
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
                onPress={() => { setStep('phone'); setError(''); }}
                disabled={loading}
              >
                <Text style={styles.textButtonText}>Change Phone Number</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={resendCode}
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
                  setPassword('');
                  setCode('');
                  setError('');
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, padding: 24 },
  title: {
    fontSize: 26, fontWeight: '700', marginBottom: 12,
    textAlign: 'center', color: '#111',
  },
  logo: {
    width: 100, height: 100, borderRadius: 22,
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  instruction: {
    fontSize: 15, color: '#555', textAlign: 'center',
    marginBottom: 24, lineHeight: 22,
  },
  errorBanner: {
    backgroundColor: '#fdecea', borderRadius: 8, padding: 12,
    marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#e53935',
  },
  errorText: { color: '#c62828', fontSize: 14, lineHeight: 20 },
  form: { width: '100%' },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, color: '#333' },
  input: {
    backgroundColor: '#ffffff', padding: 14, borderRadius: 10,
    marginBottom: 10, borderWidth: 1, borderColor: '#ddd',
    fontSize: 16, color: '#111',
  },
  codeInput: { fontSize: 22, letterSpacing: 4, textAlign: 'center' },
  helpText: { fontSize: 13, color: '#777', marginBottom: 24 },
  button: {
    backgroundColor: '#208AEF', padding: 14, borderRadius: 10,
    alignItems: 'center', marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  textButton: { marginTop: 16, padding: 10, alignItems: 'center' },
  textButtonText: { color: '#208AEF', fontSize: 15, fontWeight: '500' },
  advancedToggle: { marginTop: 32, paddingVertical: 12, alignItems: 'center' },
  advancedToggleText: { color: '#666', fontSize: 14, fontWeight: '500' },
  advancedCard: {
    backgroundColor: '#eaecee', borderRadius: 12, padding: 16, marginTop: 8,
  },
  advancedNote: { fontSize: 12, color: '#666', marginBottom: 14, lineHeight: 18 },
  secondaryButton: {
    backgroundColor: '#ffffff', padding: 12, borderRadius: 8,
    alignItems: 'center', borderWidth: 1, borderColor: '#ccc', marginTop: 8,
  },
  secondaryButtonText: { color: '#333', fontSize: 14, fontWeight: '600' },
});
