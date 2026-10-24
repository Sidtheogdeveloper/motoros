/** Shared registry/domain DTOs. Keep aligned with exported service OpenAPI and API documentation. */
export type Branch = {
  id: string;
  name: string;
  city: string;
  branchCode: string;
  status: string;
  version: number;
};
export type Tenant = { id: string; name: string };
export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address?: string | null;
  city?: string | null;
  country: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Vehicle = {
  id: string;
  customerId?: string; // Deliberately omitted for callers without CUSTOMER_READ.
  registration: string;
  vin?: string | null;
  year?: number | null;
  fuelType?: string | null;
  color?: string | null;
  status?: string;
  version?: number;
  identifierConflict?: boolean;
  make: string;
  model: string;
};
export type WorkOrder = {
  id: string;
  branchId: string;
  vehicleId: string;
  complaint: string;
  status: string;
  version: number;
  createdAt: string;
};
export type Page<T> = { content: T[]; totalElements: number; totalPages: number };

export type SourceReference = { service: 'workorder'; resourceId: string; path: string };
export type VehicleTimelineEntry = {
  id: string;
  vehicleId: string;
  branchId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  summary: string;
  source: SourceReference;
};
export type VehicleOwnership = {
  id: string;
  vehicleId: string;
  customerId: string;
  customerName: string;
  startedAt: string;
  endedAt: string | null;
  reason: string;
  actorId: string | null;
};
export type OdometerRecord = {
  id: string;
  vehicleId: string;
  branchId: string;
  kilometers: number;
  recordedAt: string;
  actorId: string;
  note: string | null;
};
export type DocumentMetadata = {
  id: string;
  vehicleId: string | null;
  customerId: string | null;
  fileName: string;
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg';
  byteSize: number;
  visibility: 'TECHNICAL' | 'CUSTOMER_PRIVATE';
  status: 'AVAILABLE' | 'DELETED';
  branchId: string;
  version: number;
  createdAt: string;
};
export type DocumentUploadGrant = {
  documentId: string;
  url: string;
  headers: Record<string, string>;
  expiresIn: 300;
};
