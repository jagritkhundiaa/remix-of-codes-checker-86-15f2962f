import { useState, useMemo, useEffect } from 'react';
import { Key, Code, Play, Loader2, CheckCircle, XCircle, Clock, AlertTriangle, RotateCcw, Users, Settings2, Hash } from 'lucide-react';
import { Header } from '@/components/Header';
import { CodeInput } from '@/components/CodeInput';
import { ResultCard } from '@/components/ResultCard';
import { StatsCard } from '@/components/StatsCard';
import { ProgressBar } from '@/components/ProgressBar';
import { Background3D } from '@/components/Background3D';
import { UsernameModal } from '@/components/UsernameModal';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckResult } from '@/types/checker';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface ClaimResult {
  email: string;
  success: boolean;
  token?: string;
  error?: string;
}

export default function Index() {
  // Username State
  const [username, setUsername] = useState<string | null>(null);
  const [isLoadingUsername, setIsLoadingUsername] = useState(true);

  // Check for saved username on mount
  useEffect(() => {
    const savedUsername = localStorage.getItem('checker_username');
    if (savedUsername) {
      setUsername(savedUsername);
    }
    setIsLoadingUsername(false);
  }, []);

  // Codes Checker State
  const [wlids, setWlids] = useState('');
  const [codes, setCodes] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState(0);
  const [checkStatus, setCheckStatus] = useState('');
  const [checkResults, setCheckResults] = useState<CheckResult[]>([]);
  const [checkThreads, setCheckThreads] = useState(10);

  // WLID Claimer State
  const [accounts, setAccounts] = useState('');
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimProgress, setClaimProgress] = useState(0);
  const [claimStatus, setClaimStatus] = useState('');
  const [claimResults, setClaimResults] = useState<ClaimResult[]>([]);
  const [claimThreads, setClaimThreads] = useState(10);

  // Codes Checker computed values
  const codesList = useMemo(() => 
    codes.split('\n').map(c => c.trim()).filter(c => c.length > 0),
    [codes]
  );

  const wlidsList = useMemo(() => 
    wlids.split('\n').map(w => w.trim()).filter(w => w.length > 0),
    [wlids]
  );

  const checkStats = useMemo(() => ({
    valid: checkResults.filter(r => r.status === 'valid').length,
    used: checkResults.filter(r => r.status === 'used').length,
    expired: checkResults.filter(r => r.status === 'expired').length,
    invalid: checkResults.filter(r => r.status === 'invalid').length,
    total: checkResults.length,
  }), [checkResults]);

  const validResults = useMemo(() => 
    checkResults.filter(r => r.status === 'valid').map(r => r.title ? `${r.code} | ${r.title}` : r.code),
    [checkResults]
  );

  const usedResults = useMemo(() => 
    checkResults.filter(r => r.status === 'used').map(r => r.code),
    [checkResults]
  );

  const expiredResults = useMemo(() => 
    checkResults.filter(r => r.status === 'expired').map(r => r.title ? `${r.code} | ${r.title}` : r.code),
    [checkResults]
  );

  const invalidResults = useMemo(() => 
    checkResults.filter(r => r.status === 'invalid').map(r => r.code),
    [checkResults]
  );

  // WLID Claimer computed values
  const accountsList = useMemo(() => 
    accounts.split('\n').map(a => a.trim()).filter(a => a.includes(':')),
    [accounts]
  );

  const claimStats = useMemo(() => ({
    success: claimResults.filter(r => r.success).length,
    failed: claimResults.filter(r => !r.success).length,
    total: claimResults.length,
  }), [claimResults]);

  const successfulTokens = useMemo(() => 
    claimResults.filter(r => r.success && r.token).map(r => r.token!),
    [claimResults]
  );

  const failedAccounts = useMemo(() => 
    claimResults.filter(r => !r.success).map(r => `${r.email}: ${r.error || 'Unknown error'}`),
    [claimResults]
  );

  // Codes Checker functions
  const checkCodes = async () => {
    if (wlidsList.length === 0) {
      toast.error('Please enter WLID tokens');
      return;
    }
    if (codesList.length === 0) {
      toast.error('Please enter codes to check');
      return;
    }

    setIsChecking(true);
    setCheckResults([]);
    setCheckProgress(0);
    setCheckStatus('Connecting to server...');

    try {
      // Always use streaming for better memory management
      setCheckStatus('Processing codes...');
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-codes`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ wlids: wlidsList, codes: codesList, threads: checkThreads, username })
        }
      );

      if (!response.ok) {
        let errorMessage = 'Server error';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // Response might not be JSON
        }
        toast.error(errorMessage);
        setIsChecking(false);
        return;
      }

      const contentType = response.headers.get('Content-Type') || '';
      
      // Handle streaming response (ndjson)
      if (contentType.includes('ndjson') || codesList.length > 500) {
        const reader = response.body?.getReader();
        if (!reader) {
          toast.error('Streaming not supported');
          setIsChecking(false);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        const resultsAccumulator: CheckResult[] = [];
        let lastUpdateTime = Date.now();
        const UPDATE_INTERVAL = 200; // Update UI every 200ms max

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              try {
                const result = JSON.parse(line);
                resultsAccumulator.push({
                  code: result.code,
                  status: result.status === 'error' ? 'invalid' : result.status,
                  title: result.title,
                });
              } catch (e) {
                console.error('Parse error:', e);
              }
            }
          }

          // Batch UI updates to prevent freezing
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            setCheckProgress(resultsAccumulator.length);
            setCheckStatus(`Processing: ${resultsAccumulator.length.toLocaleString()}/${codesList.length.toLocaleString()}`);
            // Only update results every 500 items or at intervals
            if (resultsAccumulator.length % 500 === 0) {
              setCheckResults([...resultsAccumulator]);
            }
            lastUpdateTime = now;
            // Allow browser to breathe
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const result = JSON.parse(buffer);
            resultsAccumulator.push({
              code: result.code,
              status: result.status === 'error' ? 'invalid' : result.status,
              title: result.title,
            });
          } catch (e) {
            console.error('Final parse error:', e);
          }
        }

        setCheckResults(resultsAccumulator);
        setCheckProgress(codesList.length);
        setCheckStatus('Complete!');
        toast.success(`Successfully checked ${resultsAccumulator.length.toLocaleString()} codes`);
      } else {
        // Handle regular JSON response
        const data = await response.json();
        
        if (data.error) {
          toast.error(data.error);
          setIsChecking(false);
          return;
        }

        const newResults: CheckResult[] = data.results.map((r: any) => ({
          code: r.code,
          status: r.status === 'error' ? 'invalid' : r.status,
          title: r.title,
        }));

        setCheckResults(newResults);
        setCheckProgress(codesList.length);
        setCheckStatus('Complete!');
        toast.success(`Successfully checked ${codesList.length.toLocaleString()} codes`);
      }
    } catch (err) {
      console.error('Error:', err);
      toast.error('An unexpected error occurred');
    } finally {
      setIsChecking(false);
    }
  };

  const handleCheckReset = () => {
    setCheckResults([]);
    setCheckProgress(0);
    setCheckStatus('');
  };

  // WLID Claimer functions
  const claimWlids = async () => {
    if (accountsList.length === 0) {
      toast.error('Please enter accounts (email:password format)');
      return;
    }

    setIsClaiming(true);
    setClaimResults([]);
    setClaimProgress(0);
    setClaimStatus('Connecting to server...');

    try {
      const { data, error } = await supabase.functions.invoke('claim-wlids', {
        body: { accounts: accountsList, threads: claimThreads, username }
      });

      if (error) {
        console.error('Edge function error:', error);
        toast.error('Server connection error');
        setIsClaiming(false);
        return;
      }

      if (data.error) {
        toast.error(data.error);
        setIsClaiming(false);
        return;
      }

      setClaimResults(data.results);
      setClaimProgress(accountsList.length);
      setClaimStatus('Complete!');
      toast.success(`Successfully processed ${accountsList.length} accounts`);

    } catch (err) {
      console.error('Error:', err);
      toast.error('An unexpected error occurred');
    } finally {
      setIsClaiming(false);
    }
  };

  const handleClaimReset = () => {
    setClaimResults([]);
    setClaimProgress(0);
    setClaimStatus('');
  };

  // Show loading state
  if (isLoadingUsername) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show username modal if no username
  if (!username) {
    return (
      <>
        <Background3D />
        <UsernameModal onSubmit={setUsername} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      <Background3D />
      <Header username={username} onLogout={() => { localStorage.removeItem('checker_username'); setUsername(null); }} />
      
      <main className="flex-1 container mx-auto px-4 py-8 space-y-8 relative z-10">
        <Tabs defaultValue="checker" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 glass-card mb-8">
            <TabsTrigger value="checker" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Code className="w-4 h-4 mr-2" />
              Codes Checker
            </TabsTrigger>
            <TabsTrigger value="claimer" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Users className="w-4 h-4 mr-2" />
              WLID Claimer
            </TabsTrigger>
          </TabsList>

          {/* Codes Checker Tab */}
          <TabsContent value="checker" className="space-y-8">
            {/* Input Section */}
            <div className="grid lg:grid-cols-2 gap-6">
              <CodeInput
                label="WLID Tokens"
                placeholder="Enter each WLID token on a new line..."
                value={wlids}
                onChange={setWlids}
                icon={<Key className="w-4 h-4 text-primary" />}
              />
              <CodeInput
                label="Codes"
                placeholder="Enter each code on a new line..."
                value={codes}
                onChange={setCodes}
                icon={<Code className="w-4 h-4 text-primary" />}
              />
            </div>

            {/* Threads Control */}
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-2 glass-card p-3 rounded-lg">
                <Settings2 className="w-4 h-4 text-primary" />
                <Label htmlFor="checkThreads" className="text-sm">Threads:</Label>
                <Input
                  id="checkThreads"
                  type="number"
                  min={1}
                  max={1000}
                  value={checkThreads}
                  onChange={(e) => setCheckThreads(Math.max(1, Math.min(1000, parseInt(e.target.value) || 10)))}
                  className="w-20 h-8 text-center"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-4 justify-center">
              <Button
                onClick={checkCodes}
                disabled={isChecking || codesList.length === 0 || wlidsList.length === 0}
                size="lg"
                className="min-w-[220px] gradient-primary text-primary-foreground font-semibold shadow-3d hover:shadow-glow transition-all duration-300 hover:scale-105"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Checking...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    Start Check ({codesList.length} codes)
                  </>
                )}
              </Button>
              
              {checkResults.length > 0 && !isChecking && (
                <Button 
                  variant="outline" 
                  onClick={handleCheckReset}
                  className="shadow-3d hover:shadow-glow transition-all"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
              )}
            </div>

            {/* Progress */}
            {(isChecking || checkProgress > 0) && (
              <div className="max-w-2xl mx-auto">
                <ProgressBar
                  current={checkProgress}
                  total={codesList.length}
                  status={checkStatus}
                />
              </div>
            )}

            {/* Stats */}
            {checkResults.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard
                  label="Valid"
                  value={checkStats.valid}
                  icon={<CheckCircle className="w-5 h-5" />}
                  colorClass="text-success"
                />
                <StatsCard
                  label="Used"
                  value={checkStats.used}
                  icon={<XCircle className="w-5 h-5" />}
                  colorClass="text-destructive"
                />
                <StatsCard
                  label="Expired"
                  value={checkStats.expired}
                  icon={<Clock className="w-5 h-5" />}
                  colorClass="text-expired"
                />
                <StatsCard
                  label="Invalid"
                  value={checkStats.invalid}
                  icon={<AlertTriangle className="w-5 h-5" />}
                  colorClass="text-warning"
                />
              </div>
            )}

            {/* Results */}
            {checkResults.length > 0 && (
              <div className="grid lg:grid-cols-2 gap-4">
                <ResultCard
                  title="Valid Codes"
                  icon={<CheckCircle className="w-5 h-5" />}
                  items={validResults}
                  colorClass="text-success"
                />
                <ResultCard
                  title="Used Codes"
                  icon={<XCircle className="w-5 h-5" />}
                  items={usedResults}
                  colorClass="text-destructive"
                />
                <ResultCard
                  title="Expired Codes"
                  icon={<Clock className="w-5 h-5" />}
                  items={expiredResults}
                  colorClass="text-expired"
                />
                <ResultCard
                  title="Invalid Codes"
                  icon={<AlertTriangle className="w-5 h-5" />}
                  items={invalidResults}
                  colorClass="text-warning"
                />
              </div>
            )}
          </TabsContent>

          {/* WLID Claimer Tab */}
          <TabsContent value="claimer" className="space-y-8">
            {/* Input Section */}
            <div className="max-w-2xl mx-auto">
              <CodeInput
                label="Accounts"
                placeholder="Enter accounts in email:password format, one per line..."
                value={accounts}
                onChange={setAccounts}
                icon={<Users className="w-4 h-4 text-primary" />}
              />
            </div>

            {/* Threads Control */}
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-2 glass-card p-3 rounded-lg">
                <Settings2 className="w-4 h-4 text-primary" />
                <Label htmlFor="claimThreads" className="text-sm">Threads:</Label>
                <Input
                  id="claimThreads"
                  type="number"
                  min={1}
                  max={50}
                  value={claimThreads}
                  onChange={(e) => setClaimThreads(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
                  className="w-20 h-8 text-center"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-4 justify-center">
              <Button
                onClick={claimWlids}
                disabled={isClaiming || accountsList.length === 0}
                size="lg"
                className="min-w-[220px] gradient-primary text-primary-foreground font-semibold shadow-3d hover:shadow-glow transition-all duration-300 hover:scale-105"
              >
                {isClaiming ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Claiming...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    Start Claim ({accountsList.length} accounts)
                  </>
                )}
              </Button>
              
              {claimResults.length > 0 && !isClaiming && (
                <Button 
                  variant="outline" 
                  onClick={handleClaimReset}
                  className="shadow-3d hover:shadow-glow transition-all"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset
                </Button>
              )}
            </div>

            {/* Progress */}
            {(isClaiming || claimProgress > 0) && (
              <div className="max-w-2xl mx-auto">
                <ProgressBar
                  current={claimProgress}
                  total={accountsList.length}
                  status={claimStatus}
                />
              </div>
            )}

            {/* Stats */}
            {claimResults.length > 0 && (
              <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                <StatsCard
                  label="Success"
                  value={claimStats.success}
                  icon={<CheckCircle className="w-5 h-5" />}
                  colorClass="text-success"
                />
                <StatsCard
                  label="Failed"
                  value={claimStats.failed}
                  icon={<XCircle className="w-5 h-5" />}
                  colorClass="text-destructive"
                />
              </div>
            )}

            {/* Results */}
            {claimResults.length > 0 && (
              <div className="grid lg:grid-cols-2 gap-4">
                <ResultCard
                  title="Successful Tokens"
                  icon={<CheckCircle className="w-5 h-5" />}
                  items={successfulTokens}
                  colorClass="text-success"
                />
                <ResultCard
                  title="Failed Accounts"
                  icon={<XCircle className="w-5 h-5" />}
                  items={failedAccounts}
                  colorClass="text-destructive"
                />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
