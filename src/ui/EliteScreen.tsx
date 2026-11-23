import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '../GameProvider';
import { useMultiplayer } from '../MultiplayerProvider';
import { request } from '../multiplayer/transport';
import { MULTIPLAYER_BASE_URL } from '../multiplayer/config';
import { LocalizedText as Text, LocalizedPressable as Pressable, getLocalizedPlaceName, t, toSimplified, useLocale } from '../i18n';
import { Button, Icon } from './components';
import { gameTime } from './theme';
import { ELITE_API, type EliteAttempt, type EliteBookingChoice, type EliteStatus } from '../../shared/elite';
import { ELITE_COURSE_VERSION, ELITE_QUESTIONS, gradeEliteAnswers } from '../../shared/eliteCourse';
import type { LessonCopy } from '../../shared/trainingCourse';
const statusKeys = { available: '等待回覆', accepted: '已保留預約', travelling: '前往預約上客點', waiting: '等候預約時間', 'in-trip': '載客中', completed: '預約已完成', declined: '已略過', expired: '邀請已過期', cancelled: '預約已取消', missed: '錯過預約時間', unavailable: '其他司機已接走' } as const;
export function EliteScreen({ navigation }: {
    navigation: {
        goBack: () => void;
    };
}) {
    const controller = useGame(), mp = useMultiplayer(), locale = useLocale(), { colors: c } = controller, insets = useSafeAreaInsets();
    const [mode, setMode] = useState<'solo' | 'online'>(controller.online ? 'online' : 'solo'), [phase, setPhase] = useState<'intro' | 'quiz' | 'result'>('intro'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState<EliteStatus | null>(null), [attempt, setAttempt] = useState<EliteAttempt | null>(null), [answers, setAnswers] = useState<number[]>([]), [index, setIndex] = useState(0);
    const copy = (value: LessonCopy) => locale === 'en' ? value.en : locale === 'zh-HK' ? value.hk : locale === 'zh-Hans' ? toSimplified(value.zh) : value.zh;
    const call = async <T,>(path: string, body?: unknown): Promise<T> => { const account = await mp.ensureTrainingAccount(); return request<T>(MULTIPLAYER_BASE_URL, path, body, account.driverToken); };
    const failure = (cause: unknown) => setError(cause instanceof Error ? cause.message : '未能完成操作，請重試。');
    useEffect(() => { let active = true; if (mode === 'online') {
        setBusy(true);
        void call<EliteStatus>(ELITE_API.status).then(value => { if (active)
            setStatus(value); }).catch(cause => { if (active)
            failure(cause); }).finally(() => { if (active)
            setBusy(false); });
    } return () => { active = false; }; }, [mode]);
    const certificate = mode === 'solo' ? controller.eliteCertification : status?.certification;
    const begin = async () => { setError(''); setBusy(true); try {
        setAttempt(mode === 'solo' ? { assessmentId: `solo:${Date.now()}:${Math.random().toString(36).slice(2)}`, courseVersion: ELITE_COURSE_VERSION, createdAt: Date.now() } : await call<EliteAttempt>(ELITE_API.start, { courseVersion: ELITE_COURSE_VERSION }));
        setAnswers(Array(10).fill(-1));
        setIndex(0);
        setPhase('quiz');
    }
    catch (cause) {
        failure(cause);
    }
    finally {
        setBusy(false);
    } };
    const submit = async () => { if (!attempt)
        return; setError(''); setBusy(true); try {
        let result: EliteAttempt;
        if (mode === 'solo') {
            const grade = gradeEliteAnswers(attempt.courseVersion, answers);
            if (grade.passed)
                await controller.submitEliteCourse({ assessmentId: attempt.assessmentId, courseVersion: attempt.courseVersion, answers });
            result = { ...attempt, ...grade, submittedAt: Date.now() };
        }
        else {
            result = await call<EliteAttempt>(ELITE_API.submit, { assessmentId: attempt.assessmentId, answers });
            if (result.certification) {
                setStatus({ courseVersion: ELITE_COURSE_VERSION, certification: result.certification });
                await mp.refreshDriver();
            }
        }
        setAttempt(result);
        setPhase('result');
    }
    catch (cause) {
        failure(cause);
    }
    finally {
        setBusy(false);
    } };
    const act = (bookingId: string, choice: EliteBookingChoice) => { controller.eliteBooking(bookingId, choice); if (choice === 'depart')
        navigation.goBack(); };
    const game = controller.game, bookings = game?.eliteReservations || [], question = ELITE_QUESTIONS[index];
    return <View style={{ flex: 1, backgroundColor: c.background }}><ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 24 + insets.bottom }}>
  <Text style={{ color: c.text, fontSize: 25, fontWeight: '700' }}>專屬預約（ELITE）</Text>
  <Text style={{ color: c.secondary, fontSize: 15, lineHeight: 23 }}>用合資格 Alphard 或 Vellfire，開更前揀 ELITE。開更後第 3 分鐘開始試配首張預約。</Text>
  {bookings.length ? <View style={{ gap: 12 }}><Text style={{ color: c.text, fontSize: 19, fontWeight: '600' }}>本更預約</Text>{bookings.map(booking => <View key={booking.id} testID="elite-reservation" style={{ backgroundColor: c.surface, borderRadius: 14, padding: 15, gap: 10 }}>
   <Text translate={false} style={{ color: c.text, fontSize: 19, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{gameTime(booking.pickupAt, game!.startTimeMinutes)} · {getLocalizedPlaceName(booking.offer.pickup)}</Text><Text style={{ color: c.blue, fontSize: 14 }}>{statusKeys[booking.status]}</Text>
   <Text translate={false} style={{ color: c.secondary, fontSize: 14 }}>{t('乘客')} {booking.passengerCount} · {t('大件行李')} {booking.largeLuggageCount}</Text>
   {controller.blindOrders && booking.status !== 'completed' ? <><Text style={{ color: c.secondary, fontSize: 13, lineHeight: 20 }}>目的地上車後顯示；車資完成後顯示。預約不會自動接受。</Text>{booking.status === 'in-trip' ? <Text translate={false} style={{ color: c.text, fontSize: 14 }}>{getLocalizedPlaceName(booking.offer.destination)}</Text> : null}</> : <Text translate={false} style={{ color: c.text, fontSize: 14 }}>{getLocalizedPlaceName(booking.offer.destination)} · HK${booking.offer.estimatedFare.toFixed(2)}</Text>}
   {booking.status === 'available' ? <><Text translate={false} style={{ color: c.secondary, fontSize: 12 }}>{t('回覆期限')} {gameTime(booking.respondBy, game!.startTimeMinutes)}</Text><Button testID="elite-accept" title="保留預約" colors={c} disabled={busy || !!mp.pending || !!game?.activeTrip || !!game?.queuedTrip} onPress={() => act(booking.id, 'accept')}/><Button title="略過" colors={c} secondary disabled={busy || !!mp.pending} onPress={() => act(booking.id, 'decline')}/></> : null}
   {booking.status === 'accepted' ? <Button testID="elite-depart" title="前往預約上客點" colors={c} disabled={!!mp.pending || !!game?.activeTrip || !!game?.queuedTrip} onPress={() => act(booking.id, 'depart')}/> : null}
   {['accepted', 'travelling', 'waiting', 'in-trip'].includes(booking.status) ? <Button title="取消預約" colors={c} secondary disabled={!!mp.pending || game?.phase === 'alighting'} onPress={() => act(booking.id, 'cancel')}/> : null}
  </View>)}</View> : <Text style={{ color: c.secondary, fontSize: 14, lineHeight: 22 }}>邀請會喺行車畫面出現。保留之後，撳「前往預約上客點」。</Text>}
  {phase === 'intro' ? <><View accessibilityRole="radiogroup" style={{ flexDirection: 'row', backgroundColor: c.muted, borderRadius: 12, padding: 4 }}>{(['solo', 'online'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: mode === value }} disabled={busy} onPress={() => { setError(''); setMode(value); }} style={{ minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: mode === value ? c.surface : 'transparent' }}><Text style={{ color: c.text, fontSize: 15 }}>{value === 'solo' ? '本機單人' : '線上已核實'}</Text></Pressable>)}</View><Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>{certificate ? '已取得遊戲商務資格' : '十題答對八題解鎖資格'}</Text><Text style={{ color: c.secondary, fontSize: 14, lineHeight: 22 }}>新資格由下一更起生效；本機資格不會上傳成線上認證。生涯紀錄與觀察期保持不變。</Text>{!certificate ? <Button testID="elite-begin" title={busy ? '讀取中…' : '開始十題'} colors={c} disabled={busy || (mode === 'online' && !status)} onPress={() => void begin()}/> : null}</> : null}
  {phase === 'quiz' ? <><Text translate={false} style={{ color: c.secondary, fontSize: 14 }}>{index + 1}/10</Text><Text translate={false} style={{ color: c.text, fontSize: 21, lineHeight: 29, fontWeight: '600' }}>{copy(question.prompt)}</Text>{question.choices.map((choice, i) => <Pressable key={i} testID={`elite-answer-${i}`} accessibilityRole="radio" accessibilityState={{ checked: answers[index] === i }} disabled={busy} onPress={() => setAnswers(values => values.map((value, j) => j === index ? i : value))} style={{ minHeight: 56, borderWidth: 1, borderColor: answers[index] === i ? c.blue : c.line, borderRadius: 12, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: c.surface }}><Icon name={{ ios: answers[index] === i ? 'checkmark.circle.fill' : 'circle', android: answers[index] === i ? 'radio_button_checked' : 'radio_button_unchecked' }} size={23} color={answers[index] === i ? c.blue : c.secondary}/><Text translate={false} style={{ flex: 1, color: c.text, fontSize: 16, lineHeight: 23 }}>{copy(choice)}</Text></Pressable>)}<Button testID="elite-next" title={busy ? '提交中…' : index === 9 ? '提交答案' : '下一題'} colors={c} disabled={busy || answers[index] < 0} onPress={() => index === 9 ? void submit() : setIndex(value => value + 1)}/></> : null}
  {phase === 'result' ? <><Text style={{ color: c.text, fontSize: 22, fontWeight: '600' }}>{attempt?.passed ? '已取得遊戲商務資格' : '未達合格線，可閱讀解說再試'}</Text><Text translate={false} style={{ color: c.secondary, fontSize: 18 }}>{attempt?.score}/10</Text>{ELITE_QUESTIONS.filter((_, i) => attempt?.correct?.[i] === false).map(item => <Text key={item.id} translate={false} style={{ color: c.secondary, fontSize: 15, lineHeight: 22 }}>{copy(item.explanation)}</Text>)}<Text style={{ color: c.secondary, fontSize: 14, lineHeight: 22 }}>新資格由下一更起生效；本機資格不會上傳成線上認證。生涯紀錄與觀察期保持不變。</Text><Button title="完成" colors={c} onPress={() => setPhase('intro')}/></> : null}
  {error ? <View accessibilityLiveRegion="polite" style={{ padding: 14, borderRadius: 12, backgroundColor: c.surface }}><Text style={{ color: c.text, fontSize: 14, lineHeight: 21 }}>{error}</Text></View> : null}
 </ScrollView></View>;
}
