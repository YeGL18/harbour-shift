/** Curated changes shown on the first open of each version. */
const NOTES: Readonly<Partial<Record<string, readonly string[]>>> = {
  '0.8.2': [
    '新增 1 倍速',
    '還原上一套車款圖標',
    'ELITE 開更後更早開始配對預約',
  ],
  '0.8.1': [
    '開更前揀盲單同接單類型',
    '更新車款圖標，移除路面背景車',
    '港運 Pro 同設定介面更簡潔',
  ],
};

export function releaseHighlights(version: string, dismissedVersion?: string | null): readonly string[] {
  return version === dismissedVersion ? [] : NOTES[version] ?? [];
}

