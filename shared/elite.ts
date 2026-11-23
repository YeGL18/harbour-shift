import type { Offer } from '../src/game/types';
export interface EliteCertification {
    assessmentId: string;
    courseVersion: string;
    certifiedAt: number;
}
export interface EliteSubmission {
    assessmentId: string;
    courseVersion: string;
    answers: number[];
}
export type EliteBookingChoice = 'accept' | 'decline' | 'depart' | 'cancel';
export type EliteReservationStatus = 'available' | 'accepted' | 'travelling' | 'waiting' | 'in-trip' | 'completed' | 'declined' | 'expired' | 'cancelled' | 'missed' | 'unavailable';
export interface EliteReservation {
    id: string;
    window: number;
    offer: Offer;
    announcedAt: number;
    pickupAt: number;
    respondBy: number;
    graceEndsAt: number;
    passengerCount: number;
    largeLuggageCount: number;
    status: EliteReservationStatus;
    acceptedAt?: number;
    finishedAt?: number;
}
export interface EliteAttempt {
    assessmentId: string;
    courseVersion: string;
    createdAt: number;
    submittedAt?: number;
    score?: number;
    passed?: boolean;
    correct?: boolean[];
    certification?: EliteCertification;
}
export interface EliteStatus {
    courseVersion: string;
    certification?: EliteCertification;
}
export const ELITE_API = { status: '/v1/drivers/elite', start: '/v1/drivers/elite/attempts', submit: '/v1/drivers/elite/submit' } as const;
