/** One entry of `GET/PUT /salon/business-hours`'s response array. */
export interface BusinessHoursResponseDto {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isClosed: boolean;
}
