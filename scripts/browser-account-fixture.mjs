export async function seedAccount(page,base,username){
  const result=await page.context().request.post(base+'/api/auth/register',{data:{username,password:'browser-test-secret-123',name:username}});
  if(!result.ok())throw new Error('浏览器测试账号创建失败：'+await result.text());
}
