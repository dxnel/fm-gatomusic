import { createRouter, createWebHistory } from 'vue-router'
import Release from './views/Release.vue'

const routes = [
  // "/" used to match nothing (blank page): send people to the label site instead.
  {
    path: '/',
    name: 'Home',
    component: { render: () => null },
    beforeEnter: () => {
      window.location.replace('https://gatomusic.ch')
      return false
    }
  },
  // Admin is rarely opened: load it on demand to keep the public pages light.
  { path: '/admin', name: 'Admin', component: () => import('./views/Admin.vue') },
  // Must stay last: it matches any single segment.
  { path: '/:id', name: 'Release', component: Release }
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})