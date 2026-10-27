/**
 * Google Sheets API client — stub fixtures under META_STUB / INTEGRATIONS_STUB.
 * Never dials Google from tests.
 */

import { isIntegrationsStubMode } from '@/lib/integrations/stub';

export interface SheetsValues {
  range: string;
  values: string[][];
}

export interface SheetsClient {
  getValues(spreadsheetId: string, range: string): Promise<SheetsValues>;
  updateValues(
    spreadsheetId: string,
    range: string,
    values: string[][],
  ): Promise<{ updatedRows: number }>;
}

const STUB_IMPORT: string[][] = [
  ['phone', 'name', 'email', 'company', 'tags'],
  ['9876543210', 'Priya Sharma', 'priya@example.com', 'Astra', 'vip'],
  ['9876500001', 'Ravi Kumar', 'ravi@example.com', 'Astra', 'lead'],
  ['bad', 'Nope', '', '', ''],
];

export function createSheetsClient(_accessToken: string): SheetsClient {
  if (!isIntegrationsStubMode()) {
    return {
      async getValues() {
        throw new Error(
          'Live Google Sheets is not enabled. Set META_STUB=1 or INTEGRATIONS_STUB=1.',
        );
      },
      async updateValues() {
        throw new Error(
          'Live Google Sheets is not enabled. Set META_STUB=1 or INTEGRATIONS_STUB=1.',
        );
      },
    };
  }

  return {
    async getValues(spreadsheetId, range) {
      return {
        range: `${spreadsheetId}!${range}`,
        values: STUB_IMPORT.map((row) => [...row]),
      };
    },
    async updateValues(_spreadsheetId, _range, values) {
      return { updatedRows: Math.max(0, values.length - 1) };
    },
  };
}

/** Expose stub rows for unit tests. */
export function stubImportRows(): string[][] {
  return STUB_IMPORT.map((row) => [...row]);
}
