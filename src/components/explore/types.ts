import { UploadedRecord } from '@/lib/storage/queue';

export type CategoryFilter = 'all' | 'image' | 'video' | 'audio' | 'document' | 'missing';
export type SortOption = 'newest' | 'oldest' | 'largest' | 'name';

export interface CloudItem extends UploadedRecord {
  category: 'image' | 'video' | 'audio' | 'document' | 'other';
  existsLocally?: boolean;
  cachedLocalUri?: string;
}
