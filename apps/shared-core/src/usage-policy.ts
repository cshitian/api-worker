export function detectStreamFlagFromRawJsonRequest(
	requestText: string,
): boolean | null {
	if (!requestText) {
		return null;
	}
	if (/"stream"\s*:\s*true/i.test(requestText)) {
		return true;
	}
	if (/"stream"\s*:\s*false/i.test(requestText)) {
		return false;
	}
	return null;
}

export type MissingUsagePolicyInput = {
	isStream: boolean;
	bodyParsingSkipped: boolean;
	hasUsageSignal: boolean;
};

export function shouldTreatMissingUsageAsError(
	input: MissingUsagePolicyInput,
): boolean {
	if (input.isStream) {
		return false;
	}
	if (input.bodyParsingSkipped) {
		return false;
	}
	if (!input.hasUsageSignal) {
		return false;
	}
	return true;
}
