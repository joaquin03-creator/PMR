import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw, Copy, CheckCircle2, Trash2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { clearStoragePreservingAuth } from '../lib/safeStorage';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  reported: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
    reported: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, copied: false, reported: false };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('Uncaught error:', error, errorInfo);
    
    // Auto-report to Firestore
    this.reportError(error, errorInfo);
  }

  private async reportError(error: Error, errorInfo: ErrorInfo | null) {
    try {
      await addDoc(collection(db, 'systemLogs'), {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: error.message,
        details: JSON.stringify({
          stack: error.stack,
          componentStack: errorInfo?.componentStack,
          url: window.location.href,
          userAgent: navigator.userAgent
        }),
        userId: auth.currentUser?.uid || 'anonymous',
        userEmail: auth.currentUser?.email || 'anonymous',
        operationType: 'react_error',
        path: window.location.pathname
      });
      this.setState({ reported: true });
    } catch (err) {
      console.error('Failed to report error to Firestore:', err);
    }
  }

  private handleClearCacheAndReload = () => {
    try {
      clearStoragePreservingAuth();
    } catch (e) {
      console.warn('Failed to clear storage:', e);
    }
    window.location.reload();
  };

  private copyToClipboard = () => {
    const diagnosticData = {
      message: this.state.error?.message,
      stack: this.state.error?.stack,
      componentStack: this.state.errorInfo?.componentStack,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
    
    navigator.clipboard.writeText(JSON.stringify(diagnosticData, null, 2));
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  public render() {
    if (this.state.hasError) {
      const errorMsg = (this.state.error?.message || '').toLowerCase();
      const errorName = (this.state.error?.name || '').toLowerCase();
      const isStorageOrAssertionError =
        errorName.includes('quota') ||
        errorMsg.includes('quota') ||
        errorMsg.includes('exceeded the quota') ||
        errorMsg.includes('firestore internal assertion') ||
        errorMsg.includes('setitem') ||
        errorMsg.includes('indexeddb');

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-8 text-center space-y-6">
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-10 h-10 text-red-600" />
              </div>
              
              <div className="space-y-2">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                  {isStorageOrAssertionError ? 'Local Cache Quota Exceeded' : 'Something went wrong'}
                </h1>
                <p className="text-slate-500 font-medium">
                  {isStorageOrAssertionError
                    ? "The browser's local cache or draft storage exceeded its quota. You can safely clear the offline cache and reload without losing your login session."
                    : "An unexpected error occurred. We've automatically logged this for our team to investigate."
                  }
                </p>
              </div>

              {isStorageOrAssertionError && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-left">
                  <p className="text-xs font-black uppercase tracking-wider text-amber-800 mb-1">
                    Recommended Resolution
                  </p>
                  <p className="text-xs font-medium text-amber-700">
                    Click <strong>Clear local cache and reload</strong> below. This flushes orphaned drafts and resets the local client cache so the register can continue smoothly.
                  </p>
                </div>
              )}

              <div className="bg-slate-50 rounded-2xl p-6 text-left border border-slate-100 font-mono text-sm overflow-auto max-h-48">
                <p className="text-red-600 font-bold mb-2">{this.state.error?.name}: {this.state.error?.message}</p>
                <p className="text-slate-400 text-xs whitespace-pre-wrap">
                  {this.state.error?.stack}
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={this.handleClearCacheAndReload}
                    className="flex-1 py-4 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-2xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20 active:scale-95 cursor-pointer"
                  >
                    <Trash2 className="w-5 h-5 text-slate-950" />
                    Clear local cache and reload
                  </button>
                  <button
                    onClick={() => window.location.reload()}
                    className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 active:scale-95 cursor-pointer"
                  >
                    <RotateCcw className="w-5 h-5" />
                    Reload Application
                  </button>
                </div>
                <button
                  onClick={this.copyToClipboard}
                  className="w-full py-3 border border-slate-200 text-slate-600 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-all text-sm cursor-pointer"
                >
                  {this.state.copied ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Copied Diagnostics!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Diagnostics
                    </>
                  )}
                </button>
              </div>

              {this.state.reported && (
                <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest">
                  Error successfully reported to system logs
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
