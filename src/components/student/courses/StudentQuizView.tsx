
'use client';

import { useState, useEffect } from 'react';
import { CheckSquare, ArrowRight, ArrowLeft, RefreshCw, CheckCircle2, XCircle, HelpCircle, Clock, RotateCcw, Lock, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createPortal } from 'react-dom';

interface StudentQuizViewProps {
    quiz: any;
    courseId: string;
    cohortId?: string | null;
    onComplete: (score: number, passed: boolean) => void;
    onStatusChange?: (isActive: boolean) => void;
}

const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// --- Modals ---

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, description, confirmText = "Confirm" }: any) => {
    if (!isOpen) return null;
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="text-center space-y-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-900">
                        <HelpCircle size={24} />
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
                        <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-4">
                        <button onClick={onClose} className="py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200">Cancel</button>
                        <button onClick={onConfirm} className="py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-black">{confirmText}</button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const ResultModal = ({ isOpen, result, onRetry, onClose }: any) => {
    if (!isOpen || !result) return null;

    const isPassed = result.passed;
    const canRetry = result.canRetry;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md" />
            <div className="relative bg-white rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl animate-in fade-in zoom-in duration-300 text-center space-y-8">

                <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto shadow-xl ${isPassed ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                    {isPassed ? <CheckCircle2 size={48} /> : <XCircle size={48} />}
                </div>

                <div className="space-y-2">
                    <h2 className="text-3xl font-black text-gray-900">{isPassed ? 'Congratulations!' : 'Quiz Failed'}</h2>
                    <p className="text-gray-500 font-medium">
                        {isPassed ? "You have successfully passed this quiz." : "You didn't meet the passing grade this time."}
                    </p>
                </div>

                <div className="grid grid-cols-3 gap-4 border-y border-gray-100 py-6">
                    <div>
                        <span className="text-[10px] uppercase font-bold text-gray-400">Score</span>
                        <div className={`text-2xl font-black ${isPassed ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {result.score}/{result.totalQuestions}
                        </div>
                    </div>
                    <div className="border-l border-gray-100">
                        <span className="text-[10px] uppercase font-bold text-gray-400">Percentage</span>
                        <div className={`text-2xl font-black ${isPassed ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {Math.round((result.score / result.totalQuestions) * 100)}%
                        </div>
                    </div>
                    <div className="border-l border-gray-100">
                        <span className="text-[10px] uppercase font-bold text-gray-400">Attempts</span>
                        <div className="text-2xl font-black text-gray-900">
                            {result.attemptsCount}/{result.maxAttempts}
                        </div>
                    </div>
                </div>

                <div className="pt-2">
                    {canRetry ? (
                        <button
                            onClick={onRetry}
                            className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl hover:scale-[1.02] transition-transform shadow-xl flex items-center justify-center gap-2"
                        >
                            <RotateCcw size={20} /> Retry Quiz
                        </button>
                    ) : (
                        <button
                            onClick={onClose}
                            className="w-full py-4 bg-gray-100 text-gray-900 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
                        >
                            Review Answers
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

const isItemLocked = (item: any) => {
    // Check both spread metadata and nested metadata object for robustness
    const hasUnlockDate = item.hasUnlockDate ?? item.metadata?.hasUnlockDate;
    const unlockDate = item.unlockDate ?? item.metadata?.unlockDate;
    const unlockTime = item.unlockTime ?? item.metadata?.unlockTime;

    if (!hasUnlockDate || !unlockDate) return false;
    
    try {
        const timeStr = unlockTime || "00:00";
        const unlockDateTime = new Date(`${unlockDate}T${timeStr}:00`);
        if (isNaN(unlockDateTime.getTime())) return false;
        
        return unlockDateTime.getTime() > new Date().getTime();
    } catch (e) {
        return false;
    }
};

export default function StudentQuizView({ quiz, courseId, cohortId, onComplete, onStatusChange }: StudentQuizViewProps) {
    const [answers, setAnswers] = useState<{ [key: number]: string | number }>({});
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<any>(null); // This is the payload from API
    const [started, setStarted] = useState(false);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showResultModal, setShowResultModal] = useState(false);
    const isDeadlinePassed = () => {
        const md = quiz.metadata || {};
        const hasDeadline = md.hasCloseDate === true || md.hasCloseDate === 'true' || md.hasCloseDate === 'on';
        if (!hasDeadline || !md.closeDate) return false;

        try {
            const timeStr = md.closeTime || "23:59";
            const deadline = new Date(`${md.closeDate}T${timeStr}:00`);
            return !isNaN(deadline.getTime()) && deadline.getTime() < new Date().getTime();
        } catch (e) {
            return false;
        }
    };

    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null); // { attemptsCount, maxAttempts, passed, canRetry }

    // Fetch Quiz Status on Mount
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;

                let url = `/api/student/classroom/quiz/${quiz.id}`;
                if (cohortId) url += `?cohortId=${cohortId}`;

                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                const data = await res.json();

                if (data.submission) {
                    setResult(data.submission);
                }
                setStats(data.stats);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchStatus();
    }, [quiz.id, cohortId]);

    const questions = quiz.metadata?.questions || [];
    const currentQuestion = questions[currentQuestionIndex];
    const isLastQuestion = currentQuestionIndex === questions.length - 1;
    const timeLimitMins = quiz.metadata?.timeLimit ? parseInt(quiz.metadata.timeLimit) : 0;

    // Timer Logic
    useEffect(() => {
        if (started && timeLimitMins > 0 && !result) {
            setTimeLeft(timeLimitMins * 60);
        }
    }, [started, timeLimitMins, result]);

    useEffect(() => {
        if (!timeLeft || timeLeft <= 0 || result) return;
        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev === null || prev <= 0) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [timeLeft, result]);

    // Navigation Protection
    useEffect(() => {
        const isQuizActive = started && !result;
        
        // Notify parent
        if (onStatusChange) {
            onStatusChange(isQuizActive);
        }

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isQuizActive) {
                e.preventDefault();
                e.returnValue = ''; // Required for most browsers
                return '';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (onStatusChange) onStatusChange(false);
        };
    }, [started, result, onStatusChange]);

    useEffect(() => {
        if (timeLeft === 0 && !result && !submitting && started) {
            handleFinalSubmit(true);
        }
    }, [timeLeft, result, submitting, started]);


    const handleOptionSelect = (qIdx: number, answer: string | number) => {
        if (result) return;
        setAnswers(prev => ({ ...prev, [qIdx]: answer }));
    };

    const handleFinalSubmit = async (autoSubmit = false) => {
        setSubmitting(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const res = await fetch('/api/student/classroom/quiz/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    courseId,
                    cohortId: cohortId || null,
                    quizId: quiz.id,
                    answers
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Update stats
            setStats({
                attemptsCount: data.attemptsCount,
                maxAttempts: data.maxAttempts,
                passed: data.passed,
                canRetry: data.canRetry
            });

            setResult(data); // Result contains score, etc.

            setShowResultModal(true);
            if (onComplete && data.passed) {
                onComplete(data.score, data.passed);
            }

        } catch (error: any) {
            console.error('Quiz submission failed:', error);
            if (!autoSubmit) alert(error.message || 'Failed to submit quiz.');
        } finally {
            setSubmitting(false);
            setShowConfirmModal(false);
        }
    };

    const handleRetry = () => {
        // Reset everything
        setAnswers({});
        setResult(null);
        setStarted(true);
        setShowResultModal(false);
        setCurrentQuestionIndex(0);
        setTimeLeft(timeLimitMins * 60);
    };

    const isOptionSelected = (qIdx: number, optIdx: number) => {
        const ans = answers[qIdx];
        if (ans === undefined) return false;
        return String(ans) === String(optIdx);
    };

    // Helper: Determine if we should show correct answers
    const shouldShowReview = () => {
        if (!result) return false;
        if (result.passed) return true;
        if (stats?.canRetry) return false;
        return true;
    };

    if (loading) return <div className="p-12 text-center text-gray-400">Loading quiz data...</div>;

    if (isItemLocked(quiz)) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-50 text-center h-full">
                <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400 mb-6 shadow-inner">
                    <Lock size={32} />
                </div>
                <h2 className="text-2xl font-black text-gray-900 mb-2 tracking-tight">Quiz Locked</h2>
                <p className="text-gray-500 font-medium max-w-sm mx-auto leading-relaxed">
                    This quiz is not yet available. It will unlock on {new Date(quiz.unlockDate || quiz.metadata?.unlockDate).toLocaleDateString()}.
                </p>
            </div>
        );
    }

    const showAnswers = shouldShowReview();
    const isGameActive = started && !result; // User is currently taking it
    const isReviewMode = !!result && showAnswers; // User is reviewing
    const isLockedMode = !!result && !showAnswers; // User finished but can't see answers

    if (!started && !isGameActive) {
        return (
            <div className="flex-1 h-full flex items-center justify-center p-8 bg-gray-50/50">
                <div className="max-w-2xl w-full bg-white rounded-[2rem] shadow-xl border border-gray-100 overflow-hidden text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="p-12 space-y-8">
                        <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto transform rotate-3 shadow-lg ${stats?.passed ? 'bg-emerald-50 text-emerald-600 shadow-emerald-200' : 'bg-gray-50 text-gray-900 shadow-gray-200'}`}>
                            {stats?.passed ? <CheckCircle2 size={36} /> : <CheckSquare size={36} />}
                        </div>

                        <div className="space-y-3">
                            <h1 className="text-3xl font-black text-gray-900">{quiz.title}</h1>
                            <p className="text-gray-500 font-medium leading-relaxed max-w-lg mx-auto">
                                {stats?.passed
                                    ? "You have already passed this quiz. You can review your answers."
                                    : (stats?.attemptsCount > 0
                                        ? `You have used ${stats.attemptsCount} of ${stats.maxAttempts} attempts.`
                                        : "You are about to start a quiz. Good luck!")}
                            </p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Status</span>
                                <span className={`text-lg font-black ${stats?.passed ? 'text-emerald-600' : 'text-gray-900'}`}>{stats?.passed ? 'Passed' : 'Pending'}</span>
                            </div>
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Score</span>
                                <span className="text-lg font-black text-gray-900">{result ? `${result.score}/${result.totalQuestions || questions.length}` : '-'}</span>
                            </div>
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Attempts</span>
                                <span className="text-lg font-black text-gray-900">{stats?.attemptsCount || 0} / {stats?.maxAttempts}</span>
                            </div>
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Time Limit</span>
                                <span className="text-lg font-black text-gray-900">{timeLimitMins ? `${timeLimitMins}m` : '∞'}</span>
                            </div>
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">Deadline</span>
                                <span className="text-lg font-black text-gray-900">
                                    {(quiz.metadata?.hasCloseDate && quiz.metadata?.closeDate) 
                                        ? `${new Date(quiz.metadata.closeDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${quiz.metadata.closeTime || ''}`
                                        : 'No Close'}
                                </span>
                            </div>
                        </div>

                        {stats?.passed ? (
                            <button
                                onClick={() => { setStarted(true); }} // Enters "Review Mode"
                                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
                            >
                                Review Results
                            </button>
                        ) : (
                            isDeadlinePassed() ? (
                                <button
                                    disabled
                                    className="w-full py-4 bg-gray-200 text-gray-500 rounded-2xl font-bold text-lg cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <Clock size={20} />
                                    Deadline Passed
                                </button>
                            ) : stats?.canRetry || (stats?.attemptsCount === 0 || !stats?.attemptsCount) ? ( // undefined/0 attempt count
                                <button
                                    onClick={() => handleRetry()}
                                    className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold text-lg hover:bg-black transition-all shadow-lg active:scale-95"
                                >
                                    {stats?.attemptsCount > 0 ? 'Retry Quiz' : 'Begin Quiz'}
                                </button>
                            ) : (
                                <button
                                    onClick={() => setStarted(true)} // Can only review failed attempt (game over)
                                    className="w-full py-4 bg-gray-100 text-gray-900 rounded-2xl font-bold text-lg hover:bg-gray-200 transition-all"
                                >
                                    Review Failed Attempt
                                </button>
                            )
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Active or Review View
    return (
        <div className="flex h-full flex-col md:flex-row bg-gray-50/50">
            <ConfirmationModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onConfirm={() => handleFinalSubmit(false)}
                title="Submit Quiz?"
                description="Are you sure you want to finish the quiz?"
                confirmText={submitting ? "Submitting..." : "Yes, Submit"}
            />

            <ResultModal
                isOpen={showResultModal}
                result={{ ...result, attemptsCount: stats?.attemptsCount, maxAttempts: stats?.maxAttempts, canRetry: stats?.canRetry }}
                onRetry={handleRetry}
                onClose={() => setShowResultModal(false)}
            />

            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
                <div className="bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <span className="text-lg font-black text-gray-900">Question {currentQuestionIndex + 1}</span>
                        {isReviewMode && <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-lg text-xs font-bold uppercase">Review Mode</span>}
                        {isLockedMode && <span className="bg-rose-100 text-rose-700 px-3 py-1 rounded-lg text-xs font-bold uppercase">Results Hidden</span>}
                    </div>
                    {isGameActive && timeLeft !== null && (
                        <div className="flex items-center gap-4">
                            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg border border-amber-200 text-[10px] font-bold uppercase tracking-wider animate-pulse">
                                <AlertCircle size={14} />
                                Warning: Do not reload or leave
                            </div>
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-mono font-bold transition-colors ${timeLeft < 60 ? 'bg-rose-50 text-rose-600 animate-pulse' : 'bg-gray-100 text-gray-700'}`}>
                                <Clock size={16} />
                                {formatTime(timeLeft)}
                            </div>
                        </div>
                    )}
                </div>

                {isGameActive && (
                    <div className="bg-amber-50 px-6 py-2 border-b border-amber-100 flex items-center justify-center gap-2 text-[10px] font-bold text-amber-800 uppercase tracking-widest">
                        <AlertCircle size={12} />
                        Leaving or reloading this page will submit your quiz. Unanswered questions will be marked as wrong.
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 md:p-10">
                    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-300">
                        {/* QUESTION UI (Shared) */}
                        <div className="space-y-4">
                            <h3 className="text-xl md:text-2xl font-bold text-gray-900 leading-normal">{currentQuestion?.question}</h3>

                            {/* Explicit Unanswered Warning in Review Mode */}
                            {isReviewMode && !result?.answers?.[currentQuestionIndex] && (
                                <div className="p-4 bg-orange-50 text-orange-800 rounded-xl text-sm font-bold border border-orange-100 flex items-center gap-2">
                                    <XCircle size={18} />
                                    You did not answer this question.
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            {(currentQuestion?.type === 'true-false' ? ['True', 'False'] : currentQuestion?.options)?.map((opt: string, idx: number) => {
                                const optVal = currentQuestion?.type === 'true-false' ? opt.toLowerCase() : idx;

                                let isSelected = false;
                                if (started && !result) {
                                    isSelected = isOptionSelected(currentQuestionIndex, optVal as any);
                                } else if (result && result.answers) {
                                    const savedAns = result.answers[currentQuestionIndex];
                                    isSelected = String(savedAns) === String(optVal);
                                }

                                let styles = "bg-white border-gray-200 hover:border-gray-300";
                                let showCheck = false;
                                let showUserSelection = false;

                                if (isReviewMode && result?.results) {
                                    const qResult = result.results.find((r: any) => r.questionIdx === currentQuestionIndex);
                                    const isCorrectOption = String(qResult?.correctAnswer) === String(optVal);

                                    if (isCorrectOption) {
                                        styles = "bg-emerald-50 border-emerald-500 text-emerald-900";
                                        showCheck = true;
                                    }

                                    if (isSelected) {
                                        showUserSelection = true;
                                        if (!isCorrectOption) {
                                            styles = "bg-rose-50 border-rose-500 text-rose-900";
                                        }
                                    } else if (!isCorrectOption) {
                                        styles = "bg-gray-50 border-gray-100 text-gray-400 opacity-50";
                                    }
                                } else if (isLockedMode) {
                                    if (isSelected) styles = "bg-gray-900 border-gray-900 text-white";
                                    else styles = "bg-gray-50 border-gray-100 text-gray-400";
                                } else {
                                    if (isSelected) styles = "bg-gray-900 border-gray-900 text-white shadow-lg";
                                }

                                return (
                                    <button
                                        key={idx}
                                        onClick={() => handleOptionSelect(currentQuestionIndex, optVal)}
                                        disabled={!!result}
                                        className={`w-full p-4 rounded-xl border-2 text-left font-bold transition-all flex items-center justify-between group ${styles}`}
                                    >
                                        <div className="flex items-center gap-4">
                                            {currentQuestion?.type !== 'true-false' && (
                                                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs border font-black ${isSelected && !result ? 'bg-white/20 border-white/20' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                                                    {String.fromCharCode(65 + idx)}
                                                </span>
                                            )}
                                            <span>{opt}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {showUserSelection && (
                                                <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-md ${showCheck ? 'bg-emerald-200 text-emerald-800' : 'bg-rose-200 text-rose-800'}`}>
                                                    Your Answer
                                                </span>
                                            )}
                                            {showCheck && (
                                                <div className="flex items-center gap-1 text-emerald-600">
                                                    <CheckCircle2 size={20} />
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-gray-100 bg-white flex justify-between items-center z-10 mx-6 mb-6 rounded-2xl shadow-sm border">
                    <button onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))} disabled={currentQuestionIndex === 0} className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
                        <ArrowLeft size={18} /> Prev
                    </button>
                    {isLastQuestion && !result ? (
                        <button onClick={() => setShowConfirmModal(true)} disabled={submitting} className="flex items-center gap-2 px-8 py-3 bg-emerald-600 text-white rounded-xl font-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 hover:-translate-y-0.5 transition-all">
                            {submitting ? <RefreshCw className="animate-spin" size={18} /> : "Submit Quiz"}
                        </button>
                    ) : (
                        <button onClick={() => setCurrentQuestionIndex(prev => Math.min(questions.length - 1, prev + 1))} disabled={currentQuestionIndex === questions.length - 1} className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5">
                            Next <ArrowRight size={18} />
                        </button>
                    )}
                </div>
            </div>

            <div className="w-full md:w-80 bg-white border-l border-gray-100 flex flex-col h-1/3 md:h-full overflow-hidden shrink-0">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                    <h3 className="font-black text-gray-900">Navigator</h3>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-5 gap-3">
                        {questions.map((_: any, idx: number) => {
                            let statusClass = "bg-gray-50 text-gray-400 border-transparent";
                            const isCurrent = currentQuestionIndex === idx;

                            if (isReviewMode && result?.results) {
                                const qResult = result.results.find((r: any) => r.questionIdx === idx);
                                if (qResult?.isCorrect) statusClass = "bg-emerald-100 text-emerald-700 border-emerald-200";
                                else statusClass = "bg-rose-100 text-rose-700 border-rose-200";
                            } else if (isLockedMode) {
                                statusClass = "bg-gray-100 text-gray-500";
                            } else {
                                if (isCurrent) statusClass = "bg-gray-900 text-white ring-2 ring-gray-900";
                                else if (answers[idx] !== undefined) statusClass = "bg-blue-50 text-blue-600 border-blue-200";
                            }

                            return (
                                <button key={idx} onClick={() => setCurrentQuestionIndex(idx)} className={`aspect-square rounded-xl flex items-center justify-center text-sm font-bold border transition-all ${statusClass}`}>
                                    {idx + 1}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
