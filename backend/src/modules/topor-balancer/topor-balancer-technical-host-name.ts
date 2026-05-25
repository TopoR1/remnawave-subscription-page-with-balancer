export function normalizeTechnicalHostName(value: string): string {
    return value.replace(/[\u00A0\u202F\u2007]/g, ' ').normalize('NFC').trim();
}

export function hasInvisibleCharacters(value: string): boolean {
    return /[\u200B-\u200D\u2060\uFEFF]/u.test(value);
}

export function getTechnicalHostNameMismatchReason(
    value: string,
    configuredValues: string[],
):
    | 'exact_mismatch'
    | 'invisible_characters'
    | 'leading_trailing_whitespace'
    | 'not_configured'
    | 'unicode_normalization_mismatch' {
    if (hasInvisibleCharacters(value)) {
        return 'invisible_characters';
    }

    if (value !== value.trim()) {
        return 'leading_trailing_whitespace';
    }

    const normalizedValue = normalizeTechnicalHostName(value);

    if (value.normalize('NFC') !== value) {
        return 'unicode_normalization_mismatch';
    }

    if (configuredValues.length === 0 || normalizedValue.length === 0) {
        return 'not_configured';
    }

    return 'exact_mismatch';
}

export function getClosestTechnicalHostNameCandidates(
    value: string,
    configuredValues: string[],
    limit = 3,
): string[] {
    const normalizedValue = normalizeTechnicalHostName(value).toLocaleLowerCase();

    return configuredValues
        .map((candidate) => ({
            candidate,
            distance: levenshteinDistance(
                normalizedValue,
                normalizeTechnicalHostName(candidate).toLocaleLowerCase(),
            ),
        }))
        .sort(
            (left, right) =>
                left.distance - right.distance ||
                left.candidate.localeCompare(right.candidate),
        )
        .slice(0, limit)
        .map((item) => item.candidate);
}

function levenshteinDistance(left: string, right: string): number {
    if (left === right) {
        return 0;
    }

    if (left.length === 0) {
        return right.length;
    }

    if (right.length === 0) {
        return left.length;
    }

    const previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);
    const currentRow = new Array<number>(right.length + 1);

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        currentRow[0] = leftIndex;

        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

            currentRow[rightIndex] = Math.min(
                currentRow[rightIndex - 1] + 1,
                previousRow[rightIndex] + 1,
                previousRow[rightIndex - 1] + substitutionCost,
            );
        }

        for (let index = 0; index <= right.length; index += 1) {
            previousRow[index] = currentRow[index];
        }
    }

    return previousRow[right.length];
}
