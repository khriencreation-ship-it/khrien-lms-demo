
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { courseId, quizId, answers, cohortId } = body;

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return NextResponse.json({ error: 'Unauthorized: No token provided' }, { status: 401 });

        const token = authHeader.replace('Bearer ', '');

        // Use supabaseAdmin to verify the user token
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

        if (userError || !user) {
            console.error('Auth Error:', userError);
            return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
        }

        // 1. Fetch Quiz Metadata & Check Attempts
        const { data: item } = await supabaseAdmin
            .from('module_items')
            .select('metadata')
            .eq('id', quizId)
            .single();

        if (!item) return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });

        const metadata = item.metadata || {};
        const maxAttempts = parseInt(metadata.maxAttempts || '1');

        // Check if deadline has passed
        const hasCloseDate = metadata.hasCloseDate === true || metadata.hasCloseDate === 'true' || metadata.hasCloseDate === 'on';
        if (hasCloseDate && metadata.closeDate) {
            try {
                const timeStr = metadata.closeTime || "23:59";
                const deadline = new Date(`${metadata.closeDate}T${timeStr}:00`);
                if (!isNaN(deadline.getTime()) && deadline.getTime() < new Date().getTime()) {
                    return NextResponse.json({ error: 'The deadline for this quiz has passed.' }, { status: 403 });
                }
            } catch (e) {
                console.error("Quiz deadline check error:", e);
            }
        }

        // Count existing submissions scoped by cohort
        let queryCount = supabaseAdmin
            .from('quiz_submissions')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', user.id)
            .eq('quiz_id', quizId);



        const { count: attemptsCount } = await queryCount;

        // Check if user already passed (scoped by cohort)
        let queryPassed = supabaseAdmin
            .from('quiz_submissions')
            .select('id')
            .eq('student_id', user.id)
            .eq('quiz_id', quizId)
            .eq('passed', true);



        const { data: passedSub } = await queryPassed.maybeSingle();

        if (passedSub) {
            return NextResponse.json({ error: 'You have already passed this quiz.' }, { status: 400 });
        }

        const currentAttemptNum = (attemptsCount || 0) + 1;
        if (currentAttemptNum > maxAttempts) {
            return NextResponse.json({ error: 'Max attempts exceeded.' }, { status: 400 });
        }

        // 2. Grade Quiz
        const questions = item.metadata?.questions || [];
        let score = 0;
        const totalQuestions = questions.length;

        const results = questions.map((q: any, idx: number) => {
            const studentAnswer = answers[idx];
            // Normalize comparison
            const isCorrect = String(studentAnswer).toLowerCase() === String(q.correctAnswer).toLowerCase();
            if (isCorrect) score++;
            return {
                questionIdx: idx,
                isCorrect,
                studentAnswer,
                correctAnswer: q.correctAnswer
            };
        });

        const percentage = totalQuestions > 0 ? (score / totalQuestions) * 100 : 0;
        const passingGrade = item.metadata?.passingGrade || 0;
        const passed = percentage >= passingGrade;

        // 3. Save Submission
        const { data: submission, error: saveError } = await supabaseAdmin
            .from('quiz_submissions')
            .insert({
                student_id: user.id,
                course_id: courseId,
                cohort_id: cohortId || null,
                quiz_id: quizId,
                score: score,
                total_questions: totalQuestions,
                percentage: percentage,
                passed: passed,
                answers: answers,
                results: results
            })
            .select()
            .single();

        if (saveError) throw saveError;
        
        // 4. Update Progress for ANY attempt (Pass or Fail)
        await supabaseAdmin
            .from('student_progress')
            .upsert({
                student_id: user.id,
                course_id: courseId,
                cohort_id: cohortId || null,
                item_id: quizId,
                is_completed: true,
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'student_id, item_id, cohort_id' });
        
        // 5. Determine Result Visibility
        const retriesLeft = maxAttempts - currentAttemptNum;
        const hideResults = !passed && retriesLeft > 0;

        return NextResponse.json({
            submission: {
                ...submission,
                results: hideResults ? null : submission.results // Hide results if we can retry
            },
            passed,
            score,
            totalQuestions,
            attemptsCount: currentAttemptNum,
            maxAttempts,
            canRetry: !passed && retriesLeft > 0,
            results: hideResults ? null : results // Direct results payload
        });

    } catch (error: any) {
        console.error('Quiz submission error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
