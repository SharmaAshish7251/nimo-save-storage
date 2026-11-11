export type TdAuthState =
  | 'authorizationStateWaitTdlibParameters'
  | 'authorizationStateWaitPhoneNumber'
  | 'authorizationStateWaitEmailAddress'
  | 'authorizationStateWaitEmailCode'
  | 'authorizationStateWaitCode'
  | 'authorizationStateWaitRegistration'
  | 'authorizationStateWaitPassword'
  | 'authorizationStateReady'
  | 'authorizationStateLoggingOut'
  | 'authorizationStateClosing'
  | 'authorizationStateClosed'
  | 'unknown';

export interface TdUser {
  id: number;
  first_name: string;
  last_name?: string;
  usernames?: {
    active_usernames?: string[];
    editable_username?: string;
  };
  phone_number: string;
  status?: {
    '@type': string;
  };
}

export interface TdLocalFile {
  '@type': 'localFile';
  path: string;
  can_be_downloaded: boolean;
  can_be_deleted: boolean;
  is_downloading_active: boolean;
  is_downloading_completed: boolean;
  download_offset: number;
  downloaded_prefix_size: number;
  downloaded_size: number;
}

export interface TdRemoteFile {
  '@type': 'remoteFile';
  id: string;
  unique_id: string;
  is_uploading_active: boolean;
  is_uploading_completed: boolean;
  uploaded_size: number;
}

export interface TdFile {
  '@type': 'file';
  id: number;
  size: number;
  expected_size: number;
  local: TdLocalFile;
  remote: TdRemoteFile;
}

export interface TdUploadProgress {
  fileId: number;
  uploadedSize: number;
  expectedSize: number;
  progress: number; // 0 to 1
}

export interface TdError {
  '@type': 'error';
  code: number;
  message: string;
}

export interface TelegramDestination {
  id: string;
  title: string;
  type: 'saved' | 'channel' | 'group' | 'chat';
  username?: string;
}

