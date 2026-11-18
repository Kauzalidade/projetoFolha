
test('serves the login page and authentication assets from the frontend root', async () => {
  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /<script src="\/authentication\/app\.js" defer><\/script>/);
  assert.match(pageHtml, /<form id="login-form" method="post" novalidate>/);

  const nestedPageResponse = await fetch(`${baseUrl}/authentication/index.html`);
  assert.equal(nestedPageResponse.status, 200);
  const nestedPageHtml = await nestedPageResponse.text();
  assert.match(nestedPageHtml, /href="\/authentication\/styles\.css"/);
  assert.match(nestedPageHtml, /src="\/authentication\/app\.js"/);

  for (const asset of ['/authentication/app.js', '/authentication/styles.css']) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should be served`);
  }
});
