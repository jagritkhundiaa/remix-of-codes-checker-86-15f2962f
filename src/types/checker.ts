export interface CheckResult {
  code: string;
  status: 'valid' | 'used' | 'expired' | 'invalid';
  title?: string;
}

export interface ResultStats {
  valid: number;
  used: number;
  expired: number;
  invalid: number;
  total: number;
}

export interface CheckerState {
  wlids: string;
  codes: string;
  isChecking: boolean;
  progress: number;
  results: CheckResult[];
  status: string;
}
