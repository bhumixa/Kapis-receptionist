/** `GET/POST/PATCH /salon/holidays[/:id]` response body. */
export interface HolidayResponseDto {
  id: string;
  date: string;
  reason: string;
  createdAt: string;
}
