const onVercel = /\.vercel\.app$/i.test(location.hostname);
if (onVercel) {
  import('https://esm.sh/@vercel/analytics')
    .then(({ inject }) => inject())
    .catch((e) => console.warn('Vercel analytics failed', e));
}
