import { ELITE_API, type EliteAttempt, type EliteCertification, type EliteStatus } from '../../shared/elite';
import { ELITE_COURSE_VERSION, gradeEliteAnswers } from '../../shared/eliteCourse';
import { DriverStore } from './drivers';
import type { D1Database } from './store';
import { fail, keys, object } from '../validation';
interface AttemptRow {
    id: string;
    driver_id: string;
    course_version: string;
    created_at: number;
    submitted_at: number | null;
    answers: string | null;
    score: number | null;
    passed: number;
}
interface CertificateRow {
    assessment_id: string;
    course_version: string;
    certified_at: number;
}
const certification = (row: CertificateRow): EliteCertification => ({ assessmentId: row.assessment_id, courseVersion: row.course_version, certifiedAt: row.certified_at });
export class EliteStore {
    constructor(private db: D1Database, private now: () => number = Date.now) { }
    private async certificate(driverId: string): Promise<EliteCertification | undefined> { const row = await this.db.prepare('SELECT assessment_id,course_version,certified_at FROM driver_elite_certifications WHERE driver_id=?').bind(driverId).first<CertificateRow>(); return row ? certification(row) : undefined; }
    async status(token: string): Promise<EliteStatus> { const profile = await new DriverStore(this.db, this.now).me(token); return { courseVersion: ELITE_COURSE_VERSION, certification: await this.certificate(profile.driverId) }; }
    async start(token: string, input: unknown): Promise<EliteAttempt> { const body = object(input); keys(body, ['courseVersion']); if (body.courseVersion !== ELITE_COURSE_VERSION)
        fail('elite_version', '課程已更新，請重新開始。', 409); const profile = await new DriverStore(this.db, this.now).me(token), id = crypto.randomUUID(), now = this.now(); await this.db.prepare('INSERT INTO driver_elite_attempts(id,driver_id,course_version,created_at) VALUES(?,?,?,?)').bind(id, profile.driverId, ELITE_COURSE_VERSION, now).run(); return { assessmentId: id, courseVersion: ELITE_COURSE_VERSION, createdAt: now }; }
    private async owned(token: string, id: unknown): Promise<AttemptRow> { const profile = await new DriverStore(this.db, this.now).me(token); if (typeof id !== 'string' || !/^[-A-Za-z0-9_]{1,160}$/.test(id))
        fail('invalid_elite', '答題資料無效。'); const row = await this.db.prepare('SELECT * FROM driver_elite_attempts WHERE id=? AND driver_id=?').bind(id, profile.driverId).first<AttemptRow>(); if (!row)
        fail('elite_not_found', '找不到這次學習紀錄。', 404); return row; }
    async submit(token: string, input: unknown): Promise<EliteAttempt> {
        const body = object(input);
        keys(body, ['assessmentId', 'answers']);
        const row = await this.owned(token, body.assessmentId);
        let grade;
        try {
            grade = gradeEliteAnswers(row.course_version, body.answers);
        }
        catch {
            fail('invalid_elite', '答題資料無效。');
        }
        const answers = JSON.stringify(body.answers), now = this.now();
        if (row.submitted_at !== null && row.answers !== answers)
            fail('elite_submitted', '這次答題已提交，請重新開始。', 409);
        // Grade and qualification are one transaction. A racing different submission
        // cannot obtain a certificate unless its exact answers won the update.
        await this.db.batch([
            this.db.prepare('UPDATE driver_elite_attempts SET submitted_at=?,answers=?,score=?,passed=? WHERE id=? AND driver_id=? AND submitted_at IS NULL').bind(now, answers, grade!.score, grade!.passed ? 1 : 0, row.id, row.driver_id),
            this.db.prepare(`INSERT OR IGNORE INTO driver_elite_certifications(driver_id,assessment_id,course_version,certified_at) SELECT driver_id,id,course_version,submitted_at FROM driver_elite_attempts WHERE id=? AND driver_id=? AND passed=1 AND answers=? AND submitted_at IS NOT NULL`).bind(row.id, row.driver_id, answers),
        ]);
        const saved = await this.owned(token, row.id);
        if (saved.answers !== answers)
            fail('elite_submitted', '這次答題已提交，請重新開始。', 409);
        return { assessmentId: saved.id, courseVersion: saved.course_version, createdAt: saved.created_at, submittedAt: saved.submitted_at!, score: saved.score!, passed: saved.passed === 1, correct: gradeEliteAnswers(saved.course_version, JSON.parse(saved.answers!)).correct, certification: await this.certificate(saved.driver_id) };
    }
    async handle(path: string, method: string, token: string, input?: unknown): Promise<unknown> {
        try {
            if (path === ELITE_API.status && method === 'GET')
                return await this.status(token);
            if (path === ELITE_API.start && method === 'POST')
                return await this.start(token, input);
            if (path === ELITE_API.submit && method === 'POST')
                return await this.submit(token, input);
            fail('not_found', '找不到此 API', 404);
        }
        catch (error) {
            if (error instanceof Error && /no such table: (?:main\.)?driver_elite_(?:attempts|certifications)/i.test(error.message))
                fail('elite_unavailable', '線上尊尚課程暫未開放。', 503);
            throw error;
        }
    }
}
