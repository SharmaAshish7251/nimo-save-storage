import {
  Alert,
  AppState,
  Share,
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Animated,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback, useRef } from 'react';
import { router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import QRCode from 'react-native-qrcode-svg';
import { saveApiCredentials, getApiCredentials } from '@/lib/storage/secure';
import { tdLibClient } from '@/lib/tdlib/client';
import { cleanupCachedQrImages, QrSvgRef, saveQrCodeToGallery, shareQrCodeImage } from '@/lib/telegram/qrExport';
import { restoreFromCloudProfile } from '@/lib/storage/cloudProfileSync';

export default function TelegramLoginScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

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
  const [qrOpening, setQrOpening] = useState(false);
  const [qrSaving, setQrSaving] = useState(false);
  const [qrSharing, setQrSharing] = useState(false);
  const qrSvgRef = useRef<QrSvgRef | null>(null);
  const qrSessionIdRef = useRef(0);

  // Optional custom credentials
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [hasStoredCreds, setHasStoredCreds] = useState<boolean | null>(null);
  const [savingCreds, setSavingCreds] = useState(false);
  const customCredsDirtyRef = useRef(false);
  const foregroundCheckInFlightRef = useRef(false);

  const [pulseAnim] = useState(() => new Animated.Value(1));
  const [rotateAnim] = useState(() => new Animated.Value(0));

  const completeAuthAndRedirect = async () => {
    try {
      await restoreFromCloudProfile().catch(() => null);
    } catch {}
    router.replace('/');
  };

  useEffect(() => {
    getApiCredentials().then((creds) => {
      if (creds.apiId && creds.apiHash) {
        setApiId(creds.apiId);
        setApiHash(creds.apiHash);
        setHasStoredCreds(true);
      } else {
        setHasStoredCreds(false);
        setShowAdvanced(true);
      }
    });
  }, []);

  useEffect(() => {
    tdLibClient.isLoggedIn().then((loggedIn) => {
      if (loggedIn) {
        console.log('[AUTH] Already logged in, returning home');
        completeAuthAndRedirect();
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

  const fetchQrCode = useCallback(async (forceRefresh: boolean = false) => {
    const sessionId = ++qrSessionIdRef.current;
    qrSvgRef.current = null;
    setQrLoading(true);
    setQrError(null);

    const creds = await getApiCredentials();
    const activeId = apiId.trim() || creds.apiId;
    const activeHash = apiHash.trim() || creds.apiHash;
    if (!activeId || !activeHash) {
      if (qrSessionIdRef.current !== sessionId) return;
      setShowAdvanced(true);
      setQrError('Telegram API credentials required. Please enter your API ID and API Hash below.');
      setQrLoading(false);
      return;
    }

    try {
      console.log('[AUTH] Requesting QR code login link...');
      const link = await tdLibClient.requestQrLogin(forceRefresh);
      if (qrSessionIdRef.current !== sessionId) return;
      setQrLink(link);
      setQrLoading(false);

      // Listen for confirmation and live token refreshes pushed by TDLib
      try {
        await tdLibClient.listenForQrConfirmation({
          timeoutMs: 90000,
          onLinkUpdate: (updatedLink) => {
            if (qrSessionIdRef.current !== sessionId) return;
            setQrLink(updatedLink);
          },
        });
        if (qrSessionIdRef.current !== sessionId) return;
        console.log('[AUTH] QR code confirmed successfully!');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        completeAuthAndRedirect();
      } catch (confirmErr: any) {
        if (qrSessionIdRef.current !== sessionId) return;
        const msg = String(confirmErr?.message || '');
        if (msg === 'QR_CANCELLED') {
          return;
        }
        if (msg === '2FA_REQUIRED') {
          setQrLink(null);
          setQrError(null);
          setStep('2fa');
          setAuthMethod('phone');
        } else {
          setQrError('QR code expired. Tap Refresh to generate a new code.');
        }
      }
    } catch (err: any) {
      if (qrSessionIdRef.current !== sessionId) return;
      if (String(err?.message || '') === 'QR_CANCELLED') {
        setQrLoading(false);
        return;
      }
      console.warn('[AUTH] QR request error:', err);
      setQrError(err?.message || 'Failed to generate QR code');
      setQrLoading(false);
    }
  }, []);

  const switchToPhoneTab = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    qrSessionIdRef.current += 1;
    qrSvgRef.current = null;
    setAuthMethod('phone');
    setQrLink(null);
    setQrError(null);
    setQrLoading(false);
    setError('');
    tdLibClient.cancelQrWait();
    tdLibClient.resetAuthToPhone().catch((err) => {
      console.warn('[AUTH] Background reset to phone auth failed:', err);
    });
  }, []);

  const switchToQrTab = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setError('');
    setQrError(null);
    setAuthMethod('qr');
  }, []);

  const handleOpenInTelegram = async () => {
    if (!qrLink || qrOpening) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setQrOpening(true);
    try {
      await Linking.openURL(qrLink);
    } catch {
      Alert.alert(
        'Telegram App Not Opened',
        'Could not open Telegram directly on this phone. Make sure Telegram is installed, or use Download / Share to scan the QR code from another device or Telegram gallery.'
      );
    } finally {
      setQrOpening(false);
    }
  };

  const handleShareLink = async () => {
    if (!qrLink) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await Share.share({ message: qrLink });
    } catch (err: any) {
      Alert.alert('Share Failed', err?.message || 'Could not share login link.');
    }
  };

  const handleShareQr = async () => {
    if (!qrLink || !qrSvgRef.current || qrSharing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setQrSharing(true);
    try {
      await shareQrCodeImage(qrSvgRef.current);
    } catch (err: any) {
      console.warn('[AUTH] Share QR failed:', err);
      Alert.alert(
        'Image Share Unavailable',
        err?.message || 'Could not share the QR code image.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Share Link Instead', onPress: () => { void handleShareLink(); } },
        ]
      );
    } finally {
      setQrSharing(false);
    }
  };

  const handleDownloadQr = async () => {
    if (!qrLink || !qrSvgRef.current || qrSaving) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setQrSaving(true);
    try {
      const result = await saveQrCodeToGallery(qrSvgRef.current);
      if (result.permissionDenied) {
        Alert.alert(
          'Gallery Permission Needed',
          'Allow photo library permission to save the QR image, or use Share to send it directly.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Share Instead', onPress: () => { void handleShareQr(); } },
            { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
          ]
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        'QR Saved to Gallery',
        'In Telegram go to Settings → Devices → Link Desktop Device and choose this image from your gallery (QR codes update periodically, so scan right away).'
      );
    } catch (err: any) {
      console.warn('[AUTH] Save QR failed:', err);
      Alert.alert('Download Failed', err?.message || 'Could not save QR code image to gallery.');
    } finally {
      setQrSaving(false);
    }
  };

  useEffect(() => {
    if (authMethod === 'qr' && step === 'phone' && !qrLink && !qrLoading && !qrError) {
      fetchQrCode(false);
    }
  }, [authMethod, step, qrLink, qrLoading, qrError, fetchQrCode]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || foregroundCheckInFlightRef.current) return;
      foregroundCheckInFlightRef.current = true;
      tdLibClient
        .getAuthState()
        .then((authState) => {
          if (authState === 'authorizationStateReady') {
            qrSessionIdRef.current += 1;
            tdLibClient.cancelQrWait();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            completeAuthAndRedirect();
          } else if (authState === 'authorizationStateWaitPassword' && step !== '2fa') {
            qrSessionIdRef.current += 1;
            tdLibClient.cancelQrWait();
            setQrLink(null);
            setQrError(null);
            setStep('2fa');
            setAuthMethod('phone');
          }
        })
        .catch(() => {})
        .finally(() => {
          foregroundCheckInFlightRef.current = false;
        });
    });

    return () => {
      subscription.remove();
    };
  }, [step]);

  useEffect(() => {
    return () => {
      qrSessionIdRef.current += 1;
      tdLibClient.cancelQrWait();
      cleanupCachedQrImages().catch(() => {});
    };
  }, []);

  const applyCustomCredentialsIfProvided = async (showConfirmation: boolean): Promise<boolean> => {
    const trimmedId = apiId.trim();
    const trimmedHash = apiHash.trim();
    if (!trimmedId && !trimmedHash) {
      if (showConfirmation) {
        Alert.alert('Missing Credentials', 'Enter both API ID and API Hash before saving.');
      }
      return false;
    }

    const numericId = Number(trimmedId);
    if (!trimmedId || !Number.isInteger(numericId) || numericId <= 0) {
      const msg = 'API ID must be a positive whole number from my.telegram.org.';
      if (showConfirmation) {
        Alert.alert('Invalid API ID', msg);
      } else {
        setError(msg);
      }
      return false;
    }

    if (!trimmedHash || trimmedHash.length < 16) {
      const msg = 'API Hash appears incomplete. Please enter the full hash from my.telegram.org.';
      if (showConfirmation) {
        Alert.alert('Invalid API Hash', msg);
      } else {
        setError(msg);
      }
      return false;
    }

    await saveApiCredentials(trimmedId, trimmedHash);
    setHasStoredCreds(true);
    customCredsDirtyRef.current = false;
    setQrLink(null);
    setQrError(null);
    await tdLibClient.resetAuthToPhone();

    if (showConfirmation) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(
        'Credentials Saved',
        'Custom Telegram API credentials have been saved and applied to this session.'
      );
    }
    return true;
  };

  const sendCode = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      setError('Please enter your mobile phone number.');
      return;
    }
    if (!trimmedPhone.startsWith('+')) {
      setError('Include your country code starting with + (e.g., +919876543210).');
      return;
    }

    const creds = await getApiCredentials();
    const activeId = apiId.trim() || creds.apiId;
    const activeHash = apiHash.trim() || creds.apiHash;
    if (!activeId || !activeHash) {
      setShowAdvanced(true);
      setError('Telegram API credentials required. Please enter your API ID and API Hash below.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      // Auto-save and re-initialize TDLib if custom credentials were entered or edited.
      if (customCredsDirtyRef.current && (apiId.trim() || apiHash.trim())) {
        const ok = await applyCustomCredentialsIfProvided(false);
        if (!ok) {
          return;
        }
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
    if (!trimmedCode) {
      setError('Please enter the verification code.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      console.log('[AUTH] Verifying code via TDLib...');
      await tdLibClient.verifyCode(trimmedCode);
      console.log('[AUTH] TDLib verify successful');
      await completeAuthAndRedirect();
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
    if (!password) {
      setError('Please enter your Two-Step Verification password.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      console.log('[AUTH] TDLib 2FA verify...');
      await tdLibClient.verifyPassword(password);
      console.log('[AUTH] TDLib 2FA successful');
      await completeAuthAndRedirect();
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
    if (savingCreds) return;
    setSavingCreds(true);
    setError('');
    try {
      await applyCustomCredentialsIfProvided(true);
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message || 'Could not apply custom credentials.');
    } finally {
      setSavingCreds(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <Image
            source={require('@/assets/images/app-logo.png')}
            style={styles.logo}
          />
          <Text style={[styles.title, isDark && styles.textDarkPrimary]}>Telegram Login</Text>

          {/* Error banner */}
          {!!error && (
            <View style={[styles.errorBanner, isDark && styles.errorBannerDark]}>
              <Text style={[styles.errorText, isDark && styles.errorTextDark]}>{error}</Text>
            </View>
          )}

          {/* Method Tabs */}
          {step === 'phone' && (
            <View style={[styles.tabPillRow, isDark && styles.tabPillRowDark]}>
              <TouchableOpacity
                style={[styles.tabPill, authMethod === 'phone' && styles.tabPillActive]}
                onPress={switchToPhoneTab}
              >
                <FontAwesome
                  name="phone"
                  size={14}
                  color={authMethod === 'phone' ? '#FFFFFF' : isDark ? '#94A3B8' : '#64748B'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.tabPillText,
                    isDark && styles.tabPillTextDark,
                    authMethod === 'phone' && styles.tabPillTextActive,
                  ]}
                >
                  Phone Number
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabPill, authMethod === 'qr' && styles.tabPillActive]}
                onPress={switchToQrTab}
              >
                <FontAwesome
                  name="qrcode"
                  size={14}
                  color={authMethod === 'qr' ? '#FFFFFF' : isDark ? '#94A3B8' : '#64748B'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.tabPillText,
                    isDark && styles.tabPillTextDark,
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
              <Text style={[styles.instruction, isDark && styles.textDarkSecondary]}>
                Scan with Telegram on your phone or desktop to log in instantly.
              </Text>

              <View style={[styles.qrBox, isDark && styles.qrBoxDark]}>
                {qrLoading ? (
                  <View style={styles.qrLoadingBox}>
                    <ActivityIndicator size="large" color="#208AEF" />
                    <Text style={styles.qrLoadingText}>Generating QR Code...</Text>
                  </View>
                ) : qrError ? (
                  <View style={styles.qrErrorBox}>
                    <FontAwesome name="exclamation-circle" size={36} color="#EF4444" />
                    <Text style={styles.qrErrorText}>{qrError}</Text>
                    <TouchableOpacity style={styles.qrRetryBtn} onPress={() => fetchQrCode(true)}>
                      <FontAwesome name="refresh" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.qrRetryBtnText}>Refresh QR Code</Text>
                    </TouchableOpacity>
                  </View>
                ) : qrLink ? (
                  <View style={styles.qrCodeWrap}>
                    <QRCode
                      value={qrLink}
                      size={210}
                      quietZone={16}
                      backgroundColor="#FFFFFF"
                      color="#0F172A"
                      getRef={(ref) => {
                        qrSvgRef.current = ref;
                      }}
                    />
                    <TouchableOpacity
                      style={styles.qrTimerRow}
                      onPress={() => fetchQrCode(true)}
                      activeOpacity={0.7}
                    >
                      <FontAwesome name="refresh" size={12} color="#208AEF" />
                      <Text style={styles.qrTimerText}>Updates automatically • Tap to refresh</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              {/* Same-device & export actions */}
              {qrLink && !qrLoading && !qrError && (
                <View style={styles.qrActionsWrap}>
                  <TouchableOpacity
                    style={[styles.qrPrimaryActionBtn, qrOpening && styles.buttonDisabled]}
                    onPress={handleOpenInTelegram}
                    disabled={qrOpening || qrSaving || qrSharing}
                    activeOpacity={0.85}
                  >
                    {qrOpening ? (
                      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                    ) : (
                      <FontAwesome name="paper-plane" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
                    )}
                    <Text style={styles.qrPrimaryActionText}>
                      {qrOpening ? 'Opening Telegram...' : 'Open in Telegram to Confirm'}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.qrSecondaryActionsRow}>
                    <TouchableOpacity
                      style={[
                        styles.qrSecondaryActionBtn,
                        isDark && styles.qrSecondaryActionBtnDark,
                        qrSaving && styles.buttonDisabled,
                      ]}
                      onPress={handleDownloadQr}
                      disabled={qrSaving || qrSharing || qrOpening}
                      activeOpacity={0.8}
                    >
                      {qrSaving ? (
                        <ActivityIndicator size="small" color="#208AEF" style={{ marginRight: 6 }} />
                      ) : (
                        <FontAwesome name="download" size={14} color="#208AEF" style={{ marginRight: 6 }} />
                      )}
                      <Text style={[styles.qrSecondaryActionText, isDark && styles.textDarkPrimary]}>
                        {qrSaving ? 'Saving...' : 'Download QR'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.qrSecondaryActionBtn,
                        isDark && styles.qrSecondaryActionBtnDark,
                        qrSharing && styles.buttonDisabled,
                      ]}
                      onPress={handleShareQr}
                      disabled={qrSharing || qrSaving || qrOpening}
                      activeOpacity={0.8}
                    >
                      {qrSharing ? (
                        <ActivityIndicator size="small" color="#208AEF" style={{ marginRight: 6 }} />
                      ) : (
                        <FontAwesome name="share-alt" size={14} color="#208AEF" style={{ marginRight: 6 }} />
                      )}
                      <Text style={[styles.qrSecondaryActionText, isDark && styles.textDarkPrimary]}>
                        {qrSharing ? 'Sharing...' : 'Share QR'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={styles.qrLinkShareBtn}
                    onPress={handleShareLink}
                    disabled={qrSaving || qrSharing || qrOpening}
                    activeOpacity={0.7}
                  >
                    <FontAwesome name="link" size={12} color="#208AEF" style={{ marginRight: 6 }} />
                    <Text style={styles.qrLinkShareText}>Share login link instead</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Instructions steps */}
              <View style={[styles.qrStepsCard, isDark && styles.cardDark]}>
                <Text style={[styles.qrStepsTitle, isDark && styles.textDarkPrimary]}>How to Confirm:</Text>
                <Text style={[styles.qrStepText, isDark && styles.textDarkSecondary]}>• Same phone: Tap &ldquo;Open in Telegram to Confirm&rdquo;, or Download QR and pick it inside Telegram → Settings → Devices → Link Desktop Device.</Text>
                <Text style={[styles.qrStepText, isDark && styles.textDarkSecondary]}>• Second phone / PC: Open Telegram → Settings → Devices → Link Desktop Device and scan this QR code (or Share QR to another screen).</Text>
              </View>
            </View>
          )}

          {/* STEP 1: PHONE NUMBER */}
          {step === 'phone' && authMethod === 'phone' && (
            <View style={styles.form}>
              <Text style={[styles.instruction, isDark && styles.textDarkSecondary]}>
                Enter your mobile number to sign in with Telegram.
              </Text>

              <Text style={[styles.label, isDark && styles.textDarkPrimary]}>Mobile Phone Number</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 234 567 8900"
                placeholderTextColor={isDark ? '#64748B' : '#999'}
                keyboardType="phone-pad"
                autoFocus
              />
              <Text style={[styles.helpText, isDark && styles.textDarkSecondary]}>
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

              {/* Telegram API Credentials */}
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
                  <Text style={[styles.advancedToggleText, isDark && styles.textDarkSecondary]}>
                    {hasStoredCreds
                      ? (showAdvanced ? 'Hide Telegram API Credentials' : 'Telegram API Credentials (Configured ✓)')
                      : (showAdvanced ? 'Hide Telegram API Credentials' : 'Configure Telegram API Credentials (Required)')}
                  </Text>
                </View>
              </TouchableOpacity>

              {showAdvanced && (
                <View style={[styles.advancedCard, isDark && styles.cardDark]}>
                  <Text style={[styles.advancedNote, isDark && styles.textDarkSecondary]}>
                    Telegram requires every third-party app to connect with an API ID and API Hash:
                    {'\n'}1. Log in to <Text style={{ color: '#208AEF', fontWeight: 'bold' }}>my.telegram.org</Text>
                    {'\n'}2. Go to &ldquo;API development tools&rdquo;
                    {'\n'}3. Create an app (e.g. &ldquo;Nimo Save&rdquo;) and copy your credentials below:
                  </Text>
                  <TouchableOpacity
                    style={{ marginVertical: 8, flexDirection: 'row', alignItems: 'center' }}
                    onPress={() => Linking.openURL('https://my.telegram.org')}
                  >
                    <FontAwesome name="external-link" size={12} color="#208AEF" style={{ marginRight: 6 }} />
                    <Text style={{ color: '#208AEF', fontWeight: '600', fontSize: 13 }}>
                      Open my.telegram.org in browser
                    </Text>
                  </TouchableOpacity>
                  <Text style={[styles.label, isDark && styles.textDarkPrimary]}>API ID</Text>
                  <TextInput
                    style={[styles.input, isDark && styles.inputDark]}
                    value={apiId}
                    onChangeText={(text) => {
                      customCredsDirtyRef.current = true;
                      setApiId(text);
                    }}
                    placeholder="e.g. 12345678"
                    placeholderTextColor={isDark ? '#64748B' : '#999'}
                    keyboardType="numeric"
                  />
                  <Text style={[styles.label, isDark && styles.textDarkPrimary]}>API Hash</Text>
                  <TextInput
                    style={[styles.input, isDark && styles.inputDark]}
                    value={apiHash}
                    onChangeText={(text) => {
                      customCredsDirtyRef.current = true;
                      setApiHash(text);
                    }}
                    placeholder="32 character hex hash"
                    placeholderTextColor={isDark ? '#64748B' : '#999'}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      isDark && styles.secondaryButtonDark,
                      savingCreds && styles.buttonDisabled,
                    ]}
                    onPress={saveCustomCredentials}
                    disabled={savingCreds}
                  >
                    <Text style={[styles.secondaryButtonText, isDark && styles.textDarkPrimary]}>
                      {savingCreds ? 'Applying Credentials...' : 'Save API Credentials'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* STEP 2: VERIFICATION CODE */}
          {step === 'code' && (
            <View style={styles.form}>
              <Text style={[styles.instruction, isDark && styles.textDarkSecondary]}>
                We sent a login code to your Telegram app on another device or via SMS.
              </Text>

              <Text style={[styles.label, isDark && styles.textDarkPrimary]}>Verification Code</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="1 2 3 4 5"
                placeholderTextColor={isDark ? '#64748B' : '#999'}
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
              <Text style={[styles.instruction, isDark && styles.textDarkSecondary]}>
                Your account is protected with Two-Step Verification. Enter your password to continue.
              </Text>

              <Text style={[styles.label, isDark && styles.textDarkPrimary]}>2FA Password</Text>
              <TextInput
                style={[styles.input, isDark && styles.inputDark]}
                value={password}
                onChangeText={setPassword}
                placeholder="Your Telegram Password"
                placeholderTextColor={isDark ? '#64748B' : '#999'}
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
                  setQrLink(null);
                  setQrError(null);
                  tdLibClient.resetAuthToPhone().catch(() => {});
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
    minHeight: 270,
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
  qrBoxDark: {
    borderColor: '#334155',
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
  qrActionsWrap: {
    width: '100%',
    marginBottom: 16,
    gap: 10,
  },
  qrPrimaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#208AEF',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  qrPrimaryActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  qrSecondaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  qrSecondaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  qrSecondaryActionText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  qrSecondaryActionBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  qrLinkShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  qrLinkShareText: {
    color: '#208AEF',
    fontSize: 13,
    fontWeight: '500',
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
    marginBottom: 4,
  },
  containerDark: {
    backgroundColor: '#0F172A',
  },
  cardDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
  },
  textDarkPrimary: {
    color: '#F8FAFC',
  },
  textDarkSecondary: {
    color: '#94A3B8',
  },
  errorBannerDark: {
    backgroundColor: '#450A0A',
    borderLeftColor: '#F87171',
  },
  errorTextDark: {
    color: '#FCA5A5',
  },
  inputDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    color: '#F8FAFC',
  },
  secondaryButtonDark: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
  },
  tabPillRowDark: {
    backgroundColor: '#1E293B',
  },
  tabPillTextDark: {
    color: '#94A3B8',
  },
});
