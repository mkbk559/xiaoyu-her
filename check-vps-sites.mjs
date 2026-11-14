const sites = [
  ['腾讯云轻量', 'https://cloud.tencent.com/product/lighthouse'],
  ['阿里云轻量', 'https://www.aliyun.com/product/swas'],
  ['Contabo', 'https://contabo.com/en/vps/'],
  ['野草云', 'https://www.yecaoyun.com/'],
  ['萤光云', 'https://www.yingguangyun.com/'],
]
for (const pair of sites) {
  const name = pair[0], url = pair[1]
  try {
    await createTab(url)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(6000)
    const title = String(await page.evaluate('document.title'))
    const body = String(await page.evaluate('document.body.innerText'))
    console.log(name + ' | ' + url + ' | title=' + title.slice(0, 40) + ' | chars=' + body.length)
  } catch (e) {
    console.log(name + ' | ' + url + ' | ERR ' + String(e.message).slice(0, 60))
  }
}
