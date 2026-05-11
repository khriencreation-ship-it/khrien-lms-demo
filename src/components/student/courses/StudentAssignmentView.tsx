
'use client';

import { useState, useEffect, useRef } from 'react';
import {
    UploadCloud, FileText, Send, Paperclip, X,
    Clock, AlertCircle, CheckCircle2, File
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/ui/Toast';
import RichTextEditor, { cleanHTML } from '@/components/ui/RichTextEditor';

interface StudentAssignmentViewProps {
    assignment: any;
    courseId: string;
    cohortId?: string | null;
    onComplete: (score?: number, passed?: boolean) => void;
}

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
            return null; // Expired
        };

        const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft());
        }, 1000);

        setTimeLeft(calculateTimeLeft()); // Initial call

        return () => clearInterval(timer);
    }, [targetDate]);

    if (!timeLeft) {
        return <span className="text-white/90 font-mono">Expired</span>;
    }

    // Format: 2d 14h 32m 45s
    return (
        <span className="text-white font-mono font-bold tracking-tight">
            {timeLeft.days > 0 && `${timeLeft.days}d `}
            {timeLeft.hours.toString().padStart(2, '0')}h :
            {timeLeft.mins.toString().padStart(2, '0')}m :
            {timeLeft.secs.toString().padStart(2, '0')}s
        </span>
    );
};

const isItemLocked = (item: any) => {
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

export default function StudentAssignmentView({ assignment, courseId, cohortId, onComplete }: StudentAssignmentViewProps) {
    const [files, setFiles] = useState<File[]>([]);
    const [comment, setComment] = useState('');
    const [uploading, setUploading] = useState(false);
    const [submission, setSubmission] = useState<any>(null);
    const { toasts, removeToast, showToast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch existing submission
    useEffect(() => {
        const fetchSubmission = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            try {
                let url = `/api/student/classroom/assignment/submission?assignmentId=${assignment.id}&courseId=${courseId}`;
                if (cohortId) url += `&cohortId=${cohortId}`;

                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${session.access_token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setSubmission(data);
                    if (data?.submission_data?.comment) setComment(data.submission_data.comment);
                }
            } catch (err) {
                console.error("Failed to fetch submission", err);
            }
        };
        fetchSubmission();
    }, [assignment.id, courseId, cohortId]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files);
            const limit = assignment.metadata?.fileUploadLimit || 1;
            const maxSize = (assignment.metadata?.maxFileSize || 10) * 1024 * 1024;

            const validFiles = selectedFiles.filter(f => f.size <= maxSize);
            if (validFiles.length !== selectedFiles.length) {
                showToast(`Some files exceed the ${assignment.metadata?.maxFileSize || 10}MB limit`, 'warning');
            }

            setFiles(prev => [...prev, ...validFiles].slice(0, limit));
            
            // Reset input value to allow selecting the same file again
            if (e.target) e.target.value = '';
        }
    };

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const isDeadlinePassed = () => {
        const md = assignment.metadata || {};
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

    const handleSubmit = async () => {
        if (isDeadlinePassed()) {
            showToast('The deadline for this assignment has passed.', 'error');
            return;
        }

        if (files.length === 0 && !comment) {
            showToast('Please add files or a comment', 'warning');
            return;
        }

        setUploading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const attachments = [];
            for (const f of files) {
                const folder = `student/${session.user.id}/assignments/${assignment.id}`;
                const filePath = `${folder}/${Date.now()}_${f.name}`;

                const { error: uploadError } = await supabase.storage
                    .from('submissions')
                    .upload(filePath, f, {
                        contentType: f.type,
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage
                    .from('submissions')
                    .getPublicUrl(filePath);

                attachments.push({ name: f.name, url: publicUrl, path: filePath });
            }

            const res = await fetch('/api/student/classroom/assignment/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    courseId,
                    assignmentId: assignment.id,
                    cohortId,
                    attachments,
                    comment
                })
            });

            if (!res.ok) throw new Error('Submission failed');

            const data = await res.json();
            setSubmission(data);
            showToast('Assignment submitted successfully!', 'success');
            if (onComplete) onComplete(data?.grade_data?.points, true);

            setFiles([]);
            setComment('');

        } catch (error: any) {
            console.error(error);
            showToast(error.message || 'Failed to submit assignment', 'error');
        } finally {
            setUploading(false);
        }
    };

    if (isItemLocked(assignment)) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-50 text-center h-full">
                <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400 mb-6 shadow-inner">
                    <FileText size={32} />
                </div>
                <h2 className="text-2xl font-black text-gray-900 mb-2 tracking-tight">Assignment Locked</h2>
                <p className="text-gray-500 font-medium max-w-sm mx-auto leading-relaxed">
                    This assignment is not yet available. It will unlock on {new Date(assignment.unlockDate || assignment.metadata?.unlockDate).toLocaleDateString()}.
                </p>
            </div>
        );
    }

    return (
        <div className="flex-1 h-full overflow-y-auto bg-gray-50/50 p-6 md:p-10">
            {toasts.map((toast) => (
                <Toast
                    key={toast.id}
                    message={toast.message}
                    type={toast.type}
                    onClose={() => removeToast(toast.id)}
                />
            ))}
            <div className="max-w-4xl mx-auto space-y-8">

                {/* Header Card */}
                <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-orange-500 via-rose-500 to-pink-600 p-8 md:p-12 text-white shadow-2xl shadow-rose-900/20">
                    <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none transform rotate-12 scale-150">
                        <FileText size={200} />
                    </div>

                    <div className="relative z-10 space-y-8">
                        <div>
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/20 backdrop-blur-md text-sm font-black tracking-widest uppercase mb-6 border border-white/10">
                                <FileText size={14} />
                                {assignment.metadata?.type || 'Assignment'}
                            </div>
                            <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-tight">
                                {assignment.title}
                            </h1>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 pt-8 border-t border-white/20">
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">Deadline</span>
                                {(() => {
                                    const md = assignment.metadata || {};
                                    // Handle string boolean if necessary, though route.ts now ensures it.
                                    const hasDeadline = md.hasCloseDate === true || md.hasCloseDate === 'true' || md.hasCloseDate === 'on';

                                    if (hasDeadline && md.closeDate) {
                                        const dateTimeStr = md.closeTime ? `${md.closeDate}T${md.closeTime}` : md.closeDate;
                                        return <CountdownTimer targetDate={dateTimeStr} />;
                                    }
                                    return <span className="text-xl font-black">No Deadline</span>;
                                })()}
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">Points</span>
                                <span className="text-xl font-black">{assignment.metadata?.points || 10} pts</span>
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">Min. to Pass</span>
                                <span className="text-xl font-black">{assignment.metadata?.passingScore || 5} pts</span>
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">File Max Size</span>
                                <span className="text-xl font-black">{assignment.metadata?.maxFileSize || '10'} MB</span>
                            </div>
                            <div>
                                <span className="block text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">Max Uploads</span>
                                <span className="text-xl font-black">{assignment.metadata?.fileUploadLimit || 1} Files</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Content & Submission Area */}
                <div className="grid md:grid-cols-3 gap-8">

                    {/* Left: Instructions */}
                    <div className="md:col-span-2 space-y-8">
                        <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100">
                            <h3 className="text-xl font-bold text-gray-900 mb-4">Instructions</h3>
                            <div className="prose prose-lg text-gray-600 leading-relaxed">
                                {assignment.content ? (
                                    <div dangerouslySetInnerHTML={{ __html: assignment.content }} />
                                ) : (
                                    <p className="text-gray-400 italic">No instructions provided.</p>
                                )}
                            </div>
                            {/* Attachments from Tutor */}
                            {assignment.metadata?.attachments?.length > 0 && (
                                <div className="mt-8 pt-8 border-t border-gray-50">
                                    <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                                        <Paperclip size={16} /> Attached Resources
                                    </h4>
                                    <div className="grid gap-3">
                                        {assignment.metadata.attachments.map((att: any, idx: number) => (
                                            <a
                                                key={idx}
                                                href={att.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors group"
                                            >
                                                <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-gray-400 group-hover:text-blue-600 shadow-sm transition-colors">
                                                    <FileText size={20} />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-gray-700 group-hover:text-blue-700 transition-colors">{att.name}</div>
                                                    <div className="text-xs text-gray-400">{att.size || 'Unknown size'}</div>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Submission Box */}
                    <div className="space-y-6">
                        <div className="bg-white rounded-[2rem] p-6 shadow-xl shadow-gray-200/50 border border-gray-100 sticky top-6">
                            <h3 className="text-lg font-black text-gray-900 mb-6 flex items-center gap-2">
                                <Send size={20} className="text-indigo-600" />
                                Your Submission
                            </h3>

                            {submission ? (
                                <div className="space-y-6">
                                    <div className={`p-4 rounded-xl border-l-4 ${submission.status === 'graded'
                                        ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                                        : 'bg-indigo-50 border-indigo-500 text-indigo-900'
                                        }`}>
                                        <div className="font-bold text-sm uppercase tracking-wide mb-1">Status</div>
                                        <div className="font-black text-lg capitalize">
                                            {submission.status.replace('_', ' ')}
                                        </div>
                                        {submission.grade_data?.points !== undefined && submission.grade_data?.points !== null && (
                                            <div className="mt-2 pt-2 border-t border-emerald-200 font-bold">
                                                Grade: {submission.grade_data.points}/{assignment.metadata?.points || 10}
                                            </div>
                                        )}
                                        {submission.grade_data?.feedback && (
                                            <div className="mt-3">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-2 ml-1">Tutor Feedback</div>
                                                <RichTextEditor 
                                                    content={cleanHTML(submission.grade_data.feedback)} 
                                                    onChange={() => {}} 
                                                    editable={false} 
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-3">
                                        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Submitted Files</div>
                                        {submission.submission_data?.attachments?.map((att: any, i: number) => (
                                            <a key={i} href={att.url} target="_blank" className="block p-3 bg-gray-50 rounded-xl text-sm font-medium text-blue-600 hover:underline truncate">
                                                📎 {att.name}
                                            </a>
                                        ))}
                                        {submission.submission_data?.content && (
                                            <>
                                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-4">Comments</div>
                                                <div className="p-3 bg-gray-50 rounded-xl text-sm text-gray-600 italic">
                                                    "{submission.submission_data.content}"
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {submission.status !== 'graded' && (
                                        <button
                                            onClick={() => {
                                                setComment(submission.submission_data?.comment || '');
                                                setSubmission(null);
                                            }}
                                            className="w-full py-3 text-sm font-bold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl transition-colors border border-indigo-100"
                                        >
                                            {submission.status === 'resubmit_requested' ? 'Resubmit Assignment' : 'Edit Submission'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* File Upload Zone */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Attachments</label>
                                            <span className="text-[10px] font-bold text-gray-400">{files.length} / {assignment.metadata?.fileUploadLimit || 1}</span>
                                        </div>

                                        {/* Files List */}
                                        {files.length > 0 && (
                                            <div className="space-y-2 mb-4">
                                                {files.map((f, i) => (
                                                    <div key={i} className="flex items-center justify-between p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 group">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="p-2 bg-white rounded-lg text-indigo-500 shadow-sm">
                                                                <File size={16} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-bold text-indigo-900 truncate">{f.name}</div>
                                                                <div className="text-[10px] text-indigo-400">{(f.size / 1024 / 1024).toFixed(2)} MB</div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => removeFile(i)}
                                                            className="p-1.5 text-indigo-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {files.length < (assignment.metadata?.fileUploadLimit || 1) && (
                                            <div 
                                                onClick={() => fileInputRef.current?.click()}
                                                className="relative group cursor-pointer"
                                            >
                                                <input
                                                    type="file"
                                                    ref={fileInputRef}
                                                    multiple
                                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,image/*"
                                                    onChange={handleFileChange}
                                                    className="hidden"
                                                />
                                                <div className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all border-gray-200 bg-gray-50 group-hover:border-indigo-400 group-hover:bg-indigo-50`}>
                                                    <div className="space-y-2">
                                                        <UploadCloud className="mx-auto text-gray-400 group-hover:text-indigo-500 transition-colors" size={32} />
                                                        <div className="text-sm font-bold text-gray-500 group-hover:text-indigo-600">Click to upload</div>
                                                        <div className="text-xs text-gray-400 text-center mx-auto max-w-[200px]">
                                                            Max {assignment.metadata?.maxFileSize || '10'}MB per file.
                                                            Allowed: PDFs, Docs, Images.
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Comment Box */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Comments</label>
                                        <textarea
                                            value={comment}
                                            onChange={(e) => setComment(e.target.value)}
                                            placeholder="Add a note to your teacher..."
                                            className="w-full p-4 rounded-xl bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 font-medium text-gray-700 transition-all resize-none h-32"
                                        />
                                    </div>

                                    <button
                                        onClick={handleSubmit}
                                        disabled={uploading || isDeadlinePassed()}
                                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-indigo-200 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-70 disabled:scale-100 flex items-center justify-center gap-2"
                                    >
                                        {uploading ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Submitting...
                                            </>
                                        ) : isDeadlinePassed() ? (
                                            <>
                                                Deadline Passed
                                                <Clock size={20} className="opacity-60" />
                                            </>
                                        ) : (
                                            <>
                                                Turn In Assignment
                                                <ArrowRight size={20} className="opacity-60" />
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper icon
import { ArrowRight } from 'lucide-react';
