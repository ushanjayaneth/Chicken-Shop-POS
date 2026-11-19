export interface Employee {
  id:string;branchId:string;name:string;phone:string;position:string;monthlySalary:number;active:boolean;createdAt:string;updatedAt:string;
}
export interface Attendance {
  id:string;branchId:string;employeeId:string;date:string;status:'present'|'absent'|'leave';checkIn:string|null;checkOut:string|null;note:string;updatedAt:string;createdBy:string;
}
export interface StaffTransaction {
  id:string;branchId:string;employeeId:string;account:'advance'|'loan';direction:'issued'|'repaid';amount:number;method:'cash'|'card'|'qr'|'payroll';reference:string;note:string;payrollId:string|null;createdAt:string;createdBy:string;
}
export interface Payroll {
  id:string;branchId:string;employeeId:string;employeeName:string;period:string;baseSalary:number;bonus:number;otherDeduction:number;advanceDeduction:number;loanDeduction:number;gross:number;net:number;method:'cash'|'card'|'qr';reference:string;note:string;createdAt:string;createdBy:string;
}
export function staffBalance(entries:StaffTransaction[],employeeId:string,account:'advance'|'loan'):number {
  return entries.filter(row=>row.employeeId===employeeId&&row.account===account).reduce((sum,row)=>sum+(row.direction==='issued'?row.amount:-row.amount),0);
}
export function staffCashflows(entries:StaffTransaction[],payroll:Payroll[],employees:Employee[]){
  const date=(timestamp:string)=>new Date(timestamp).toLocaleDateString('en-CA',{timeZone:'Asia/Colombo'});
  return [...entries.filter(row=>row.method!=='payroll').map(row=>({date:date(row.createdAt),timestamp:row.createdAt,type:`staff-${row.account}-${row.direction}`,reference:row.reference||row.id,description:`${employees.find(person=>person.id===row.employeeId)?.name??row.employeeId}: ${row.account} ${row.direction}`,method:row.method,income:row.direction==='repaid'?row.amount:0,expense:row.direction==='issued'?row.amount:0})),...payroll.map(row=>({date:date(row.createdAt),timestamp:row.createdAt,type:'salary-payment',reference:row.reference||row.id,description:`Salary: ${row.employeeName} / ${row.period}`,method:row.method,income:0,expense:row.net}))];
}
