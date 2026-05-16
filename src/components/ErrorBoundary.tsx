import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw, Copy, CheckCircle2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

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
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-8 text-center space-y-6">
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-10 h-10 text-red-600" />
              </div>
              
              <div className="space-y-2">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Something went wrong</h1>
                <p className="text-slate-500 font-medium">
                  An unexpected error occurred. We've automatically logged this for our team to investigate.
                </p>
              </div>

              <div className="bg-slate-50 rounded-2xl p-6 text-left border border-slate-100 font-mono text-sm overflow-auto max-h-48">
                <p className="text-red-600 font-bold mb-2">{this.state.error?.name}: {this.state.error?.message}</p>
                <p className="text-slate-400 text-xs whitespace-pre-wrap">
                  {this.state.error?.stack}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                >
                  <RotateCcw className="w-5 h-5" />
                  Reload Application
                </button>
                <button
                  onClick={this.copyToClipboard}
                  className="flex-1 py-4 border border-slate-200 text-slate-600 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-all"
                >
                  {this.state.copied ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-5 h-5" />
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
