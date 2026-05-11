
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { courseId, assignmentId, attachments, comment, cohortId } = body;

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // Check if deadline has passed
        const { data: assignmentItem, error: assignmentError } = await supabaseAdmin
            .from('module_items')
            .select('metadata')
            .eq('id', assignmentId)
            .single();

        if (assignmentError || !assignmentItem) {
            return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
        }

        const metadata = assignmentItem.metadata || {};
        const hasCloseDate = metadata.hasCloseDate === true || metadata.hasCloseDate === 'true' || metadata.hasCloseDate === 'on';
        
        if (hasCloseDate && metadata.closeDate) {
            try {
                const timeStr = metadata.closeTime || "23:59";
                const deadline = new Date(`${metadata.closeDate}T${timeStr}:00`);
                if (!isNaN(deadline.getTime()) && deadline.getTime() < new Date().getTime()) {
                    return NextResponse.json({ error: 'The deadline for this assignment has passed.' }, { status: 403 });
                }
            } catch (e) {
                console.error("Deadline check error:", e);
            }
        }

        // Check if already submitted (if multiple submissions not allowed)
        // For now, assuming standard submission flow allows one active, or just inserts new one.
        // We'll insert a new record.

        // Check if already submitted to handle "upsert" manually since unique constraint might be missing
        let query = supabaseAdmin
            .from('assignment_submissions')
            .select('id')
            .eq('student_id', user.id)
            .eq('item_id', assignmentId);

        const { data: existing } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

        let data, error;
        const submissionPayload = {
            student_id: user.id,
            course_id: courseId,
            cohort_id: cohortId || null,
            item_id: assignmentId,
            submission_data: {
                attachments: attachments || [],
                comment: comment || '',
                submitted_at: new Date().toISOString()
            },
            status: 'submitted',
            updated_at: new Date().toISOString()
        };

        if (existing) {
            const { data: updateData, error: updateError } = await supabaseAdmin
                .from('assignment_submissions')
                .update({
                    submission_data: submissionPayload.submission_data,
                    status: 'submitted',
                    updated_at: submissionPayload.updated_at
                })
                .eq('id', existing.id)
                .select()
                .single();
            data = updateData;
            error = updateError;
        } else {
            const { data: insertData, error: insertError } = await supabaseAdmin
                .from('assignment_submissions')
                .insert(submissionPayload)
                .select()
                .single();
            data = insertData;
            error = insertError;
        }

        if (error) throw error;

        // Auto-mark as completed in progress? 
        // Typically explicit "Mark Done" or auto on submit. Let's do auto.
        await supabaseAdmin
            .from('student_progress')
            .upsert({
                student_id: user.id,
                course_id: courseId,
                cohort_id: cohortId || null,
                item_id: assignmentId,
                is_completed: true,
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'student_id, item_id, cohort_id' });

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Assignment submission error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
