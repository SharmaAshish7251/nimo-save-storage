import { View, StyleSheet, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { saveApiCredentials, getApiCredentials } from '@/lib/storage/secure';
import { startAuth, signIn, signInWithPassword } from '@/lib/telegram/client';

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

  useEffect(() => {
    (async () => {
      try {
        const creds = await getApiCredentials();
        if (creds.apiId) setApiId(creds.apiId);
        if (creds.apiHash) setApiHash(creds.apiHash);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const sendCode = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      Alert.alert('Phone Required', 'Please enter your mobile phone number with country code (e.g. +1234567890).');
      return;
    }

    if (!trimmedPhone.startsWith('+')) {
      Alert.alert('Invalid Format', 'Please include your country code with a leading + (e.g. +1234567890).');
      return;
    }

    setLoading(true);
    try {
      const result = await startAuth(trimmedPhone);
      setPhoneCodeHash(result.phoneCodeHash);
      setStep('code');
      Alert.alert('Code Sent', 'Telegram has sent a verification code to your Telegram app or via SMS.');
    } catch (error: any) {
      Alert.alert('Login Error', error?.message || 'Failed to send login code. Please check your phone number.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      Alert.alert('Code Required', 'Please enter the verification code you received.');
      return;
    }

    setLoading(true);
    try {
      await signIn(phone.trim(), trimmedCode, phoneCodeHash);
      Alert.alert('Success', 'Logged in successfully to Telegram!', [
        { text: 'OK', onPress: () => router.replace('/') }
      ]);
    } catch (error: any) {
      if (error.message === '2FA_PASSWORD_REQUIRED') {
        setStep('2fa');
      } else {
        Alert.alert('Verification Failed', error?.message || 'Incorrect verification code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const verify2FA = async () => {
    if (!password) {
      Alert.alert('Password Required', 'Please enter your 2FA password.');
      return;
    }

    setLoading(true);
    try {
      await signInWithPassword(password);
      Alert.alert('Success', 'Logged in successfully!', [
        { text: 'OK', onPress: () => router.replace('/') }
      ]);
    } catch (error: any) {
      Alert.alert('2FA Failed', error?.message || 'Incorrect 2FA password.');
    } finally {
      setLoading(false);
    }
  };

  const saveCustomCredentials = async () => {
    if (!apiId.trim() || !apiHash.trim()) {
      Alert.alert('Required', 'Please enter both API ID and API Hash.');
      return;
    }
    try {
      await saveApiCredentials(apiId.trim(), apiHash.trim());
      Alert.alert('Saved', 'Custom API credentials saved successfully.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save credentials.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
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
                <Text style={styles.buttonText}>
                  {loading ? 'Sending Code...' : 'Send Login Code'}
                </Text>
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
                <Text style={styles.buttonText}>
                  {loading ? 'Verifying...' : 'Verify & Sign In'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={() => setStep('phone')}
                disabled={loading}
              >
                <Text style={styles.textButtonText}>Change Phone Number</Text>
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
                <Text style={styles.buttonText}>
                  {loading ? 'Signing In...' : 'Confirm Password'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textButton}
                onPress={() => setStep('phone')}
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
    marginTop: 20,
    color: '#111',
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
