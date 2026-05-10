
'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/tutor/DashboardLayout';
import {
    ArrowLeft,
    FileText,
    Users,
    CheckCircle2,
    Clock,
    Download,
    ExternalLink,
    MessageSquare,
    ShieldCheck,
    AlertCircle,
    Send,
    ChevronRight,
    Search,
    Filter,
    MoreVertical,
    Sparkles
} from 'lucide-react';
import AIPlagiarismChecker from '@/components/tutor/assignments/AIPlagiarismChecker';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/authClient';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/ui/Toast';
import RichTextEditor from '@/components/ui/RichTextEditor';

interface AssignmentSubmissionsClientProps {
    assignment: any;
    courseId: string;
    courseTitle: string;
    cohortId?: string; // Added cohortId
    readOnly?: boolean;
    backUrl?: string;
}

// Reusing CountdownTimer from Student View (Consider moving to shared component)
const CountdownTimer = ({ targetDate }: { targetDate: string }) => {
    const [timeLeft, setTimeLeft] = useState<{ days: number, hours: number, mins: number, secs: number } | null>(null);

    useEffect(() => {
        const calculateTimeLeft = () => {
            const difference = +new Date(targetDate) - +new Date();
            if (difference > 0) {
                return {
                    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
                    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
                    mins: Math.floor((difference / 1000 / 60) % 60),
                    secs: Math.floor((difference / 1000) % 60)
                };
            }
            return null;
        };

        const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft());
        }, 1000);

        return () => clearInterval(timer);
    }, [targetDate]);

    if (!timeLeft) return <span className="text-red-500 font-black">Closed</span>;

    return (
        <div className="flex items-center gap-2 text-sm font-black text-orange-600 bg-orange-50 px-3 py-1 rounded-lg border border-orange-100">
            <Clock size={14} />
            <span>{timeLeft.days}d {timeLeft.hours}h {timeLeft.mins}m {timeLeft.secs}s</span>
        </div>
    );
};

export default function AssignmentSubmissionsClient({ assignment, courseId, courseTitle, cohortId, readOnly = false, backUrl }: AssignmentSubmissionsClientProps) {
    const router = useRouter();
    const [submissions, setSubmissions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
    const [gradingPoints, setGradingPoints] = useState<number | ''>('');
    const [gradingFeedback, setGradingFeedback] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [aiSourceText, setAiSourceText] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'submitted' | 'graded' | 'resubmit_requested'>('all');
    const [user, setUser] = useState<any>(null);
    const { toasts, removeToast, success, error, warning } = useToast();

    // ... (rest of state and effects)

    useEffect(() => {
        const fetchUser = async () => {
            const userData = await getCurrentUser();
            setUser(userData);
        };
        fetchUser();
        fetchSubmissions();
    }, [cohortId]); // Re-fetch if cohortId changes

    const fetchSubmissions = async () => {
        setLoading(true);
        try {
            let url = `/api/tutor/submissions?itemId=${assignment.id}`;
            if (cohortId) url += `&cohortId=${cohortId}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                setSubmissions(data);
            }
        } catch (err) {
            console.error('Failed to fetch submissions', err);
            error('Failed to load submissions');
        } finally {
            setLoading(false);
        }
    };

    const maxPoints = assignment.metadata?.points || assignment.metadata?.totalPoints || 10;

    const handleGradeSubmit = async (status: 'graded' | 'resubmit_requested' = 'graded') => {
        if (!selectedSubmission || !user || readOnly) return;
        if (status === 'graded' && gradingPoints === '') {
            warning('Please enter a grade');
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch('/api/tutor/submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submissionId: selectedSubmission.id,
                    points: gradingPoints !== '' ? Number(gradingPoints) : 0,
                    feedback: gradingFeedback,
                    tutorId: user.id,
                    status
                })
            });

            if (res.ok) {
                success(status === 'graded' ? 'Grade submitted successfully' : 'Resubmission requested');
                await fetchSubmissions(); // Refresh list
                const updated = submissions.find(s => s.id === selectedSubmission.id);
                if (updated) setSelectedSubmission({ ...updated, status, grade_data: { points: gradingPoints, feedback: gradingFeedback } });
            } else {
                error(status === 'graded' ? 'Failed to save grade' : 'Failed to request resubmission');
            }
        } catch (err) {
            console.error('Error saving grade:', err);
            error('An error occurred while saving');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAIGrade = async () => {
        if (!selectedSubmission) return;
        
        // Priority for text to analyze:
        // 1. Manually pasted text in aiSourceText
        // 2. Student's comment in submission_data.content
        const textToAnalyze = aiSourceText || selectedSubmission.submission_data?.content;
        
        if (!textToAnalyze) {
            warning('Please provide some text to analyze. Paste the student\'s work or ensure they provided a comment.');
            return;
        }

        setIsGeneratingAI(true);
        try {
            const res = await fetch('/api/ai/grade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assignmentTitle: assignment.title,
                    assignmentInstructions: assignment.content,
                    submissionText: textToAnalyze,
                    maxPoints: maxPoints,
                    studentName: selectedSubmission.student?.full_name || 'Student'
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to generate AI grade');
            }

            const data = await res.json();
            setGradingPoints(data.score);
            setGradingFeedback(data.feedback);
            success('AI Grading generated! Please review before saving.');
        } catch (err: any) {
            console.error('AI Grading Error:', err);
            error(err.message || 'An error occurred while generating AI grade');
        } finally {
            setIsGeneratingAI(false);
        }
    };

    const filteredSubmissions = submissions.filter(sub => {
        const student = sub.student || {};
        const matchesSearch =
            (student.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (student.identifier || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter = filterStatus === 'all' || sub.status === filterStatus;
        return matchesSearch && matchesFilter;
    });

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'graded':
                return 'bg-emerald-50 text-emerald-600 border-emerald-100';
            case 'resubmit_requested':
            case 'resubmission_requested':
                return 'bg-orange-50 text-orange-600 border-orange-100';
            default:
                return 'bg-blue-50 text-blue-600 border-blue-100';
        }
    };

    // Render Deadline Logic
    const renderDeadline = () => {
        const md = assignment.metadata || {};
        if (md.hasCloseDate && md.closeDate) {
            const dateTimeStr = md.closeTime ? `${md.closeDate}T${md.closeTime}` : md.closeDate;
            return <CountdownTimer targetDate={dateTimeStr} />;
        }
        return <span className="text-sm font-bold text-gray-400">No Deadline</span>;
    };

    return (
        <DashboardLayout isLoading={loading} allowAdmin={readOnly}>
            {/* Toast notifications */}
            {toasts.map((toast) => (
                <Toast
                    key={toast.id}
                    message={toast.message}
                    type={toast.type}
                    onClose={() => removeToast(toast.id)}
                />
            ))}
            <div className="max-w-7xl mx-auto space-y-8 pb-20">
                {/* Navigation & Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="space-y-4">
                        <Link
                            href={backUrl || `/tutor/courses/${courseId}`}
                            className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-900 font-bold text-sm transition-colors group"
                        >
                            <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                            {backUrl ? 'Back' : 'Back to Course'}
                        </Link>
                        <div className="space-y-1">
                            <h1 className="text-4xl font-black text-gray-900 tracking-tight">{assignment.title}</h1>
                            <div className="flex items-center gap-4 text-gray-500 font-medium text-sm">
                                <span className="text-primary font-bold">{courseTitle}</span>
                                <span>•</span>
                                <span>Submissions Management</span>
                                <span>•</span>
                                {renderDeadline()}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center gap-6">
                            <div className="text-center">
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Total</p>
                                <p className="text-xl font-black text-gray-900">{submissions.length}</p>
                            </div>
                            <div className="w-px h-8 bg-gray-100" />
                            <div className="text-center">
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Graded</p>
                                <p className="text-xl font-black text-emerald-600">{submissions.filter(s => s.status === 'graded').length}</p>
                            </div>
                            <div className="w-px h-8 bg-gray-100" />
                            <div className="text-center">
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Pending</p>
                                <p className="text-xl font-black text-blue-600">{submissions.filter(s => s.status === 'submitted').length}</p>
                            </div>
                            <div className="w-px h-8 bg-gray-100" />
                            <div className="text-center">
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Re-submit</p>
                                <p className="text-xl font-black text-orange-600">{submissions.filter(s => s.status === 'resubmit_requested' || s.status === 'resubmission_requested').length}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Panel: Submission List */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-xl shadow-gray-200/40 overflow-hidden">
                            <div className="p-6 border-b border-gray-50 flex flex-col gap-4">
                                <div className="relative group">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-primary transition-colors" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Search student..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-transparent focus:bg-white focus:border-primary/20 rounded-2xl text-sm font-bold outline-none transition-all placeholder:text-gray-300"
                                    />
                                </div>
                                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                                    {(['all', 'submitted', 'graded', 'resubmit_requested'] as const).map((status) => (
                                        <button
                                            key={status}
                                            onClick={() => setFilterStatus(status)}
                                            className={`flex-1 min-w-[80px] py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filterStatus === status ? 'bg-gray-900 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                                        >
                                            {status.replace('_', '-')}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
                                {loading ? (
                                    <div className="p-12 text-center space-y-4">
                                        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Loading Submissions...</p>
                                    </div>
                                ) : filteredSubmissions.length > 0 ? (
                                    filteredSubmissions.map((sub) => (
                                        <button
                                            key={sub.id}
                                            onClick={() => {
                                                setSelectedSubmission(sub);
                                                setGradingPoints(sub.grade_data?.points ?? '');
                                                setGradingFeedback(sub.grade_data?.feedback ?? '');
                                            }}
                                            className={`w-full p-6 text-left hover:bg-gray-50 transition-all flex items-center justify-between group ${selectedSubmission?.id === sub.id ? 'bg-primary/5 border-l-4 border-primary' : ''}`}
                                        >
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className="w-12 h-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center font-black text-lg group-hover:bg-primary/20 group-hover:text-primary transition-colors shrink-0 overflow-hidden">
                                                    {sub.student?.avatar_url ? (
                                                        <img src={sub.student.avatar_url} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        sub.student?.full_name?.charAt(0) || 'S'
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-bold text-gray-900 truncate group-hover:text-primary transition-colors">{sub.student?.full_name || 'Unknown Student'}</p>
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">{sub.student?.identifier || 'NO-ID'}</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-2">
                                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter border ${getStatusStyle(sub.status)}`}>
                                                    {sub.status === 'submitted' ? 'New' : sub.status.replace('_', ' ')}
                                                </span>
                                                <p className="text-[9px] text-gray-300 font-bold">{new Date(sub.created_at).toLocaleDateString()}</p>
                                            </div>
                                        </button>
                                    ))
                                ) : (
                                    <div className="p-12 text-center space-y-4 bg-gray-50/50">
                                        <Users className="mx-auto text-gray-200" size={48} />
                                        <div className="space-y-1">
                                            <p className="font-bold text-gray-900">No submissions found</p>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Students haven't submitted yet</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Panel: Grading & Detail View */}
                    <div className="lg:col-span-2 space-y-8">
                        {selectedSubmission ? (
                            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {/* Submission Detail Header */}
                                <div className="p-8 bg-white rounded-[2.5rem] border border-gray-100 shadow-xl shadow-gray-200/40 space-y-8">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-gray-50">
                                        <div className="flex items-center gap-4">
                                            <div className="w-16 h-16 rounded-3xl bg-primary text-white flex items-center justify-center font-black text-2xl shadow-xl shadow-primary/20">
                                                {selectedSubmission.student?.full_name?.charAt(0) || 'S'}
                                            </div>
                                            <div className="space-y-1">
                                                <h3 className="text-2xl font-black text-gray-900 leading-none">{selectedSubmission.student?.full_name}</h3>
                                                <p className="text-xs text-gray-400 font-bold uppercase tracking-[0.2em]">{selectedSubmission.student?.identifier || 'Student Identifier'}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="text-right">
                                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Submitted on</p>
                                                <p className="text-sm font-bold text-gray-900">{new Date(selectedSubmission.created_at).toLocaleString()}</p>
                                            </div>
                                            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-300">
                                                <Clock size={24} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Submitted Files/Links */}
                                    <div className="space-y-6">
                                        <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                                            <FileText size={16} className="text-primary" />
                                            Submitted Artifacts
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {(selectedSubmission.submission_data?.attachments || selectedSubmission.submission_data?.files)?.map((file: any, i: number) => (
                                                <a
                                                    key={i}
                                                    href={file.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center justify-between p-5 bg-gray-50 rounded-2xl border border-transparent hover:border-primary hover:bg-white transition-all group shadow-sm hover:shadow-lg"
                                                >
                                                    <div className="flex items-center gap-4 min-w-0">
                                                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-primary shadow-sm group-hover:scale-110 transition-transform">
                                                            <Download size={20} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-black text-gray-900 truncate">{file.name || 'Submitted File'}</p>
                                                            <p className="text-[10px] text-gray-400 font-bold uppercase">Material Upload</p>
                                                        </div>
                                                    </div>
                                                </a>
                                            ))}
                                            {selectedSubmission.submission_data?.links?.map((link: string, i: number) => (
                                                <a
                                                    key={i}
                                                    href={link.startsWith('http') ? link : `https://${link}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center justify-between p-5 bg-blue-50/30 rounded-2xl border border-transparent hover:border-blue-500 hover:bg-white transition-all group shadow-sm hover:shadow-lg"
                                                >
                                                    <div className="flex items-center gap-4 min-w-0">
                                                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-blue-600 shadow-sm group-hover:scale-110 transition-transform">
                                                            <ExternalLink size={20} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-black text-gray-900 truncate">{link}</p>
                                                            <p className="text-[10px] text-gray-400 font-bold uppercase">External Link</p>
                                                        </div>
                                                    </div>
                                                </a>
                                            ))}
                                        </div>

                                        {/* Student Notes / Comment */}
                                        {(selectedSubmission.submission_data?.student_notes || selectedSubmission.submission_data?.comment) && (
                                            <div className="space-y-4 pt-4">
                                                <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                                                    <MessageSquare size={16} className="text-primary" />
                                                    Student Note
                                                </h4>
                                                <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100 text-gray-600 text-sm font-medium italic leading-relaxed">
                                                    "{selectedSubmission.submission_data.student_notes || selectedSubmission.submission_data.comment}"
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* AI Plagiarism Checker */}
                                {(() => {
                                    const sources = [];
                                    if (selectedSubmission.submission_data?.comment) {
                                        sources.push({ label: 'Student Comment', value: selectedSubmission.submission_data.comment });
                                    }
                                    if (selectedSubmission.submission_data?.student_notes) {
                                        sources.push({ label: 'Student Notes', value: selectedSubmission.submission_data.student_notes });
                                    }

                                    return (
                                        <AIPlagiarismChecker
                                            studentId={selectedSubmission.student_id}
                                            assignmentId={selectedSubmission.item_id}
                                            availableSources={sources}
                                            availableFiles={(selectedSubmission.submission_data?.attachments || selectedSubmission.submission_data?.files) || []}
                                            initialText={sources[0]?.value || ""}
                                        />
                                    );
                                })()}

                                {/* Grading Form */}
                                <div className="p-8 bg-gray-900 rounded-[2.5rem] text-white shadow-2xl shadow-gray-900/40 space-y-8 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                                        <ShieldCheck size={160} />
                                    </div>

                                    <div className="relative z-10 space-y-8">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-1">
                                                <h4 className="text-xl font-black tracking-tight">{readOnly ? 'Submission Details' : 'Grade Submission'}</h4>
                                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{readOnly ? 'View student work and details' : 'Mark as Graded or Request Resubmission'}</p>
                                            </div>
                                            {selectedSubmission.status === 'graded' && (
                                                <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl flex items-center gap-2 text-xs font-black">
                                                    <CheckCircle2 size={16} />
                                                    GRADED
                                                </div>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                                            <div className="space-y-3">
                                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Score / {maxPoints}</label>
                                                <input
                                                    type="number"
                                                    value={gradingPoints}
                                                    onChange={(e) => setGradingPoints(e.target.value === '' ? '' : Number(e.target.value))}
                                                    placeholder="0"
                                                    readOnly={readOnly}
                                                    className={`w-full bg-white/5 border border-white/10 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-2xl px-6 py-4 text-2xl font-black outline-none transition-all placeholder:text-gray-700 ${readOnly ? 'cursor-default opacity-70' : ''}`}
                                                />
                                            </div>
                                            <div className="md:col-span-3 space-y-3">
                                                <div className="flex items-center justify-between mb-1">
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Instructor Feedback</label>
                                                    {!readOnly && (
                                                        <button 
                                                            onClick={handleAIGrade}
                                                            disabled={isGeneratingAI}
                                                            className="flex items-center gap-1.5 px-3 py-1 bg-purple-500/10 text-purple-400 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-purple-500 hover:text-white transition-all disabled:opacity-50"
                                                        >
                                                            {isGeneratingAI ? (
                                                                <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                                                            ) : (
                                                                <Sparkles size={12} />
                                                            )}
                                                            {isGeneratingAI ? 'Analyzing...' : 'Assist with AI'}
                                                        </button>
                                                    )}
                                                </div>
                                                
                                                {!readOnly && (
                                                    <div className="mb-4">
                                                        <textarea 
                                                            value={aiSourceText}
                                                            onChange={(e) => setAiSourceText(e.target.value)}
                                                            placeholder="Paste student's work here for AI analysis (Optional if they provided a comment)..."
                                                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-gray-300 focus:border-purple-500 outline-none transition-all resize-none h-20"
                                                        />
                                                    </div>
                                                )}

                                                <RichTextEditor
                                                    content={gradingFeedback}
                                                    onChange={setGradingFeedback}
                                                    placeholder={readOnly ? "No feedback provided" : "Great work! Here are some suggestions..."}
                                                    editable={!readOnly}
                                                />
                                            </div>
                                        </div>

                                        {!readOnly && (
                                            <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
                                                <button
                                                    onClick={() => handleGradeSubmit()}
                                                    disabled={isSaving}
                                                    className="w-full sm:flex-1 py-4 bg-primary hover:bg-primary/95 text-white rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-xl shadow-primary/20 flex items-center justify-center gap-2 group disabled:opacity-50"
                                                >
                                                    {isSaving ? (
                                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    ) : (
                                                        <>
                                                            Save Grade
                                                            <Send size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleGradeSubmit('resubmit_requested')}
                                                    disabled={isSaving}
                                                    className="w-full sm:w-auto px-8 py-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-2xl font-black text-sm uppercase tracking-widest transition-all border border-white/10 flex items-center justify-center gap-2 group disabled:opacity-50"
                                                >
                                                    Request Resubmission
                                                    <AlertCircle size={18} className="text-orange-500" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full min-h-[500px] flex flex-col items-center justify-center p-12 bg-gray-50/50 rounded-[3rem] border-2 border-dashed border-gray-100 text-center space-y-6">
                                <div className="w-24 h-24 rounded-[2rem] bg-white text-gray-200 flex items-center justify-center shadow-sm">
                                    <Users size={48} />
                                </div>
                                <div className="space-y-2">
                                    <h3 className="text-2xl font-black text-gray-900">Select a Submission</h3>
                                    <p className="text-sm text-gray-400 font-bold uppercase tracking-widest max-w-xs mx-auto">
                                        Choose a student from the left panel to review their work and provide feedback.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}
