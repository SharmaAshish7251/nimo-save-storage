import { View, StyleSheet, Text, TextInput, TouchableOpacity, ScrollView, Image, Animated, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import { saveApiCredentials } from '@/lib/storage/secure';
import { tdLibClient } from '@/lib/tdlib/client';

export default function TelegramLoginScreen() {
  const [authMethod, setAuthMethod] = useState<'phone' | 'qr'>('phone');
  const [step, setStep] = useState<'phone' | 'code' | '2fa'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // QR Code login state
  const [qrLink, setQrLink] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrCountdown, setQrCountdown] = useState(30);

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

  const fetchQrCode = useCallback(async () => {
    setQrLoading(true);
    setQrError(null);
    setQrCountdown(30);
    try {
      console.log('[AUTH] Requesting QR code login link...');
      const link = await tdLibClient.requestQrLogin();
      setQrLink(link);
      setQrLoading(false);

      // Listen for confirmation asynchronously
      try {
        await tdLibClient.listenForQrConfirmation(35000);
        console.log('[AUTH] QR code confirmed successfully!');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        router.replace('/');
      } catch (confirmErr: any) {
        if (confirmErr?.message === '2FA_REQUIRED') {
          setStep('2fa');
          setAuthMethod('phone');
        } else {
          setQrError('QR code expired. Tap to refresh.');
        }
      }
    } catch (err: any) {
      console.warn('[AUTH] QR request error:', err);
      setQrError(err?.message || 'Failed to generate QR code');
      setQrLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authMethod === 'qr' && !qrLink && !qrLoading) {
      fetchQrCode();
    }
  }, [authMethod, qrLink, qrLoading, fetchQrCode]);

  // Countdown timer for QR refresh
  useEffect(() => {
    if (authMethod !== 'qr' || !qrLink || qrLoading || qrError) return;
    const interval = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          fetchQrCode();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [authMethod, qrLink, qrLoading, qrError, fetchQrCode]);

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

          {/* Method Tabs */}
          {step === 'phone' && (
            <View style={styles.tabPillRow}>
              <TouchableOpacity
                style={[styles.tabPill, authMethod === 'phone' && styles.tabPillActive]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setAuthMethod('phone');
                }}
              >
                <FontAwesome
                  name="phone"
                  size={14}
                  color={authMethod === 'phone' ? '#FFFFFF' : '#64748B'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.tabPillText,
                    authMethod === 'phone' && styles.tabPillTextActive,
                  ]}
                >
                  Phone Number
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabPill, authMethod === 'qr' && styles.tabPillActive]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setAuthMethod('qr');
                }}
              >
                <FontAwesome
                  name="qrcode"
                  size={14}
                  color={authMethod === 'qr' ? '#FFFFFF' : '#64748B'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.tabPillText,
                    authMethod === 'qr' && styles.tabPillTextActive,
                  ]}
                >
                  QR Code
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* QR CODE LOGIN VIEW */}
          {step === 'phone' && authMethod === 'qr' && (
            <View style={styles.qrContainer}>
              <Text style={styles.instruction}>
                Scan with Telegram on your phone or desktop to log in instantly.
              </Text>

              <View style={styles.qrBox}>
                {qrLoading ? (
                  <View style={styles.qrLoadingBox}>
                    <ActivityIndicator size="large" color="#208AEF" />
                    <Text style={styles.qrLoadingText}>Generating QR Code...</Text>
                  </View>
                ) : qrError ? (
                  <View style={styles.qrErrorBox}>
                    <FontAwesome name="exclamation-circle" size={36} color="#EF4444" />
                    <Text style={styles.qrErrorText}>{qrError}</Text>
                    <TouchableOpacity style={styles.qrRetryBtn} onPress={fetchQrCode}>
                      <FontAwesome name="refresh" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.qrRetryBtnText}>Refresh QR Code</Text>
                    </TouchableOpacity>
                  </View>
                ) : qrLink ? (
                  <View style={styles.qrCodeWrap}>
                    <QRCode
                      value={qrLink}
                      size={210}
                      backgroundColor="#FFFFFF"
                      color="#0F172A"
                    />
                    <View style={styles.qrTimerRow}>
                      <FontAwesome name="clock-o" size={12} color="#64748B" />
                      <Text style={styles.qrTimerText}>Auto-refreshes in {qrCountdown}s</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {/* Instructions steps */}
              <View style={styles.qrStepsCard}>
                <Text style={styles.qrStepsTitle}>Quick Steps:</Text>
                <Text style={styles.qrStepText}>1. Open Telegram on your phone or PC</Text>
                <Text style={styles.qrStepText}>2. Go to Settings → Devices → Link Desktop Device</Text>
                <Text style={styles.qrStepText}>3. Point camera at this QR code to confirm</Text>
              </View>
            </View>
          )}

          {/* STEP 1: PHONE NUMBER */}
          {step === 'phone' && authMethod === 'phone' && (
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
  // Tab Pills
  tabPillRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    gap: 4,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  tabPillActive: {
    backgroundColor: '#208AEF',
    shadowColor: '#208AEF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  tabPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  tabPillTextActive: {
    color: '#FFFFFF',
  },
  // QR Container & Box
  qrContainer: {
    alignItems: 'center',
    width: '100%',
  },
  qrBox: {
    width: 260,
    height: 270,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
    marginBottom: 20,
  },
  qrCodeWrap: {
    alignItems: 'center',
  },
  qrTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  qrTimerText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  qrLoadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  qrLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  qrErrorBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  qrErrorText: {
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  qrRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#208AEF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  qrRetryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  qrStepsCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  qrStepsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  qrStepText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
});
